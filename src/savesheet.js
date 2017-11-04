const _ = require('lodash');
const moment = require('moment');
const CronJob = require('cron').CronJob;
const jsdiff = require("diff");

const google = require('googleapis');
const OAuth2 = google.auth.OAuth2;

let oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET, [process.env.GOOGLE_REDIRECT_URN, process.env.GOOGLE_REDIRECT_URL]
);

oauth2Client.setCredentials({
  access_token: process.env.GOOGLE_ACCESS_TOKEN,
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

let getResearchMeetingSchedule = (auth) => {
  return new Promise((resolve, reject) => {
    let sheets = google.sheets('v4');
    sheets.spreadsheets.values.get({
      auth: auth,
      spreadsheetId: process.env.SHEET_URL,
      range: 'schedule!B2:E',
    }, function (err, response) {
      if (err) {
        return reject(err);
      }
      resolve(response.values);
    });
  });
};

let parseSheetData = (data) => {
  let validUserData = _.filter(data, (o) => {

    if (_.isUndefined(o[3])) {
      return false;
    } else if (o[3] === '-') {
      return false;
    } else {
      return true;
    }
  });

  let convertData = _.map(validUserData, (n) => {
    return {
      name: n[3],
      day: moment(_.split(n[0], '(')[0], "YYYY/MM/DD")
    }
  });

  return convertData;
};

let filterTime = (datas) => {
  let now = moment();
  return _.filter(datas, (d) => {
    if (now < d.day) {
      return true;
    } else {
      return false;
    }
  });
};

let toString = (datas) => {
  return _.reduce(datas, (sum, n) => {
    return sum + n.day.format('MM/DD') + " " + n.name + "\n";
  }, "");
};

module.exports = robot => {
  robot.brain.once('save', () => {
    let monitorList = robot.brain.get('REMINDER_CHANNEL') || {};
    let oldData = filterTime(robot.brain.get('SHEETSCHEDULE') || []);

    new CronJob('* */30 * * * *', async() => {
      robot.logger.debug("Scrape spreadsheet");
      let data = await getResearchMeetingSchedule(oauth2Client);
      let parseData = filterTime(parseSheetData(data));

      if (toString(oldData) !== toString(parseData)) {
        let diffStr = jsdiff.createPatch("Research Paper Schedule", toString(oldData), toString(parseData), "old", "new");
        let options = {
          title: "輪講スケジュールが更新されたよ〜",
          filename: "Checkしてね.study",
          content: diffStr,
          filetype: 'diff'
        };

        _.forEach(monitorList, (v, k) => {
          if (v) {
            options.channels = k;
            robot.adapter.client.web.files.upload("schedule.diff", options);
          }
        });

        oldData = parseData;
        robot.brain.set('REMINDER_CHANNEL', oldData);
      }
    }, null, true, 'Asia/Tokyo');
  });
}
