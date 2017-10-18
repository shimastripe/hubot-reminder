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

let monitorList = {};

let createFields = () => {
  let jpTime = moment().utcOffset(9);
  let checkTime = jpTime.add(1, 'days');

  return new Promise((resolve, reject) => {
    ical.fromURL(process.env.ICAL_URL, {}, (err, data) => {
      let fields = [];
      let today = moment().utcOffset(9).add(1, 'd');
      let [todayM, todayD] = [today.month(), today.date()];

      _.forEach(data, (v, k) => {
        let ev = v;
        let startDate = moment(ev.start);
        let endDate = moment(ev.end);

        if (!(todayM === startDate.month() && todayD === startDate.date())) {
          return true;
        }

        if (_.includes(ev.description, FLAG)) {
          let text = '*' + ev.summary + '*';
          let timeStr = startDate.format('kk:mm') + ' - ' + endDate.format('kk:mm');

          let memo = _.split(_.split(ev.description, FLAG + "{")[1], "}")[0];
          if (!_.isUndefined(memo)) {
            text += "\n" + memo;
          }

          let field = {
            title: timeStr,
            value: text,
          };

          fields.push(field);
        }
      });

      resolve(fields);
    });
  });
};

module.exports = robot => {
  robot.brain.once('save', () => {
    robot.logger.debug("DB init");
    monitorList = robot.brain.get('REMINDER_CHANNEL') || {};

    new CronJob('0 0 17 * * *', () => {
      reminderToSlack();
    }, null, true, TZ);
  });

  robot.hear(/reminder$/, (res) => {
    reminderToSlack();
  });

  let reminderToSlack = async() => {
    try {
      let fields = await createFields()
      let att = {
        fallback: 'Next schedule',
        color: randomColor(),
        pretext: '@channel 明日の予定だよ〜〜〜',
        fields: fields,
        footer: 'reminder',
        footer_icon: 'https://emoji.slack-edge.com/T110Z5F17/version/953e3addf396be42.png',
        mrkdwn_in: ["pretext", "text", "fields"]
      }

      if (_.isEmpty(fields)) {
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
    let old = monitorList[payload.channel_id];
    if (_.isUndefined(old)) {
      old = false;
    }
    let payload = req.body;

    monitorList[payload.channel_id] = !old;
    robot.brain.set('MONITOR_SWITCH_CHANNEL', monitorList);
    res.send('Update reminder status in this channel: ' + !old);
  });
};
