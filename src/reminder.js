'use strict';
// Description
//   Schedule reminder for lab slack
//
// Configuration:
//   
//
// Commands:
//   /reminder-toggle <boolean>
//
// Author:
//   Go Takagi <takagi@shimastripe.com>

const _ = require('lodash');
const moment = require('moment');
const ical = require('node-ical');
const CronJob = require('cron').CronJob;
const randomColor = require('randomcolor');
const TZ = 'Asia/Tokyo';
const FLAG = 'REMINDER';
const FLAG2 = 'SPREADSHEET';

let monitorList = {};
let scheduleData = [];

let getICALData = () => {
  return new Promise((resolve, reject) => {
    ical.fromURL(process.env.ICAL_URL, {}, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      let allData = _.flatMap(data, (n) => {
        if (n.rrule) {
          let startDate = moment(n.start);
          let endDate = moment(n.end);
          let interval = endDate - startDate;

          return _.map(n.rrule.all(), (m) => {
            return {
              summary: n.summary,
              description: n.description,
              location: n.location,
              start: moment(m).toDate(),
              end: moment(m).add(interval).toDate()
            };
          });
        } else {
          return n;
        }
      });
      resolve(allData);
    });
  });
};

let filterCalData = (calendarData, searchDay) => {
  return _.filter(calendarData, (data) => (searchDay.month() === moment(data.start).month() && searchDay.date() === moment(data.start).date()));
};

let filterRemindData = (calendarData) => {
  return _.filter(calendarData, (data) => _.includes(data.description, FLAG));
};


let generateFields = async (offSetDay) => {
  let searchDay = moment().utcOffset(9).add(offSetDay, 'd');
  let allDataList = await getICALData();
  let thatDayDataList = filterCalData(allDataList, searchDay);
  let remindDataList = filterRemindData(thatDayDataList);
  let fields = [];

  _.forEach(remindDataList, (ev, k) => {
    let eventName = ev.summary;

    let timeStr = moment(ev.start).format('kk:mm') + ' - ' + moment(ev.end).format('kk:mm');
    if (timeStr === "24:00 - 24:00") {
      timeStr = '終日';
    }

    let eventField = {
      title: "Event",
      value: eventName,
      short: false
    };
    fields.push(eventField);

    let timeField = {
      title: "Time",
      value: timeStr,
      short: true
    };
    fields.push(timeField);

    let loc = ev.location;
    if (loc === "") {
      loc = 'NONE';
    }

    let locField = {
      title: "Location",
      value: loc,
      short: true
    };
    fields.push(locField);

    if (_.includes(ev.description, FLAG2)) {
      let data = _.filter(scheduleData, (item) => {
        return Math.abs(searchDay - moment(item.day)) <= 86400000; // 24 hours
      });

      let detail = _.reduce(data, (sum, n) => {
        return sum + "@" + n.name + " ";
      }, "");

      let detailField = {
        title: "Detail",
        value: detail,
        short: false
      };

      fields.push(detailField);
    }

    let detail = _.split(_.split(ev.description, FLAG + "{")[1], "}")[0];
    if (!(_.isUndefined(detail) || detail === "")) {
      let detailField = {
        title: "Detail",
        value: detail,
        short: false
      };

      fields.push(detailField);
    }
  });

  return fields;
};

module.exports = robot => {
  let reminderToSlack = async (offSetDay) => {
    try {
      let fields = await generateFields(offSetDay)
      let att = {
        fallback: 'Next schedule',
        color: randomColor(),
        pretext: '@channel 明日の予定だよ〜〜〜',
        fields: fields,
        footer: 'reminder',
        footer_icon: 'https://emoji.slack-edge.com/T110Z5F17/version/953e3addf396be42.png',
        mrkdwn_in: ["pretext", "text", "fields"]
      }

      if (!_.isEmpty(fields)) {
        _.forEach(monitorList, (v, k) => {
          if (v) {
            robot.messageRoom(k, {
              attachments: [att]
            });
          }
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  robot.brain.once('save', () => {
    robot.logger.debug("reminder.js");
    monitorList = robot.brain.get('REMINDER_CHANNEL') || {};
    scheduleData = robot.brain.get('SHEETSCHEDULE') || [];

    new CronJob('0 0 17 * * *', () => {
      robot.logger.debug("ReminderToSlack");
      reminderToSlack(1);
    }, null, true, TZ);
  });

  robot.router.post('/slash/reminder/toggle', (req, res) => {
    if (req.body.token !== process.env.HUBOT_SLACK_TOKEN_VERIFY) {
      res.send("Verify Error");
      return;
    }

    if (req.body.challenge != null) {
      let challenge = req.body.challenge;
      return res.json({
        challenge: challenge
      });
    }

    robot.logger.debug("/reminder-toggle");
    let payload = req.body;
    let old = monitorList[payload.channel_id];
    if (_.isUndefined(old)) {
      old = false;
    }

    monitorList[payload.channel_id] = !old;
    robot.brain.set('REMINDER_CHANNEL', monitorList);
    res.send('Update reminder status in this channel: ' + !old);
  });

  robot.respond(/reminder (\d+)$/i, (res) => {
    reminderToSlack(res.match[1]);
  });

  robot.respond(/checkreminder$/i, (res) => {
    let obj = robot.brain.get('REMINDER_CHANNEL') || {};
    res.reply("" + JSON.stringify(obj));
  });

  robot.respond(/resetreminder$/i, (res) => {
    robot.brain.set('REMINDER_CHANNEL', {});
    res.reply("Reset REMINDER_CHANNEL");
  });
};
