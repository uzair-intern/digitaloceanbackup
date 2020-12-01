#!/usr/local/bin/node
/**
 * Author: haxpor
 * Link: https://github.com/haxpor/digittaloceanbackup
 * It can be used as it is, otherwise see README.md on github.
 */

'use strict';

require('dotenv').config();

require('./promise-retry.js');
const mainCall = require('./promise-syncloop.js');
const readline = require('readline');
const ConfigFile = require('./ConfigFile.js');
const DGApi = require('./DGApi.js');
// const wechatNotify = require('wechat-notifier');

//Google Chat Params
const fetch = require('node-fetch');
const webhookURL = process.env.GCHAT_WEBHOOK;

//statusCode here
const statCode = ['Result :'];
var window = [''];

var configFile = new ConfigFile(__dirname + '/config.json');

// get access token as set in environment variable
const access_token = process.env.DIGITALOCEAN_ACCESS_TOKEN;
if (access_token == null || access_token == '') {
        console.log(process.env);
        console.log('Error. Access token is not set yet, or invalid.\nSet it to via\n\t export DIGITALOCEAN_ACCESS_TOKEN=\'<your access token>\'');
        process.exit(-1);
}

// create DGApi
var dgApi = new DGApi(access_token);

try {
        // read config file
        // then get config content read into memory inside ConfigFile
        configFile.read();
} catch(e) {
        console.log(e);
        process.exit(-1);
}

// get config settings
const dropletIds = configFile.dropletIds;
const holdSnapshots = configFile.holdSnapshots;

// see promise-synclook.js for this function signature detail
// deleteFn is for deleting oldest snapshot task one by one
var deleteFn = function(i, ...args) {

        // get snapshots parameter
        var snapshots = args[0];

        return new Promise((resolve, reject) => {
                // snapshots object is the same, thus we moving index ourselves via i
                // snapshots is returned from API as sorted in ascending order
                var oldestSnapshotId = snapshots[i].id;
                // delete oldest snapshot
                console.log('Deleting oldest snapshot (id:' + oldestSnapshotId + ')');
                Promise.retry(3, dgApi.deleteSnapshotById.bind(dgApi), 3000, oldestSnapshotId)
                        .then((_result) => {
                                console.log('Deleted snapshot (id: ' + oldestSnapshotId + ')');
                                resolve();      // resolve the task
                        })
                        .catch((_err) => {
                                console.log(_err.message);
                                reject(_err); // reject this task
                        });
        });
}

// see promise-syncloop.js for this function signature detail
// workerFn is for main task for individual snapshot involving
// getting list of snapshots, deleting snapshots (if need), and snapshot a droplet
var workerFn = function(i, ...args) {
        return new Promise((resolve, reject) => {
                // get id from droplet
                const dropletId = dropletIds[i];

                var snapshots = null;

                // now we got dropletIds in memory of our configFile
                console.log('Getting list of snapshots for dropletId (id:' + dropletId + ')');
                Promise.retry(3, dgApi.getListOfSnapshotsForDropletId.bind(dgApi), 3000, dropletId)
                        .then((result) => {
                                var resultObj = JSON.parse(result);
                                snapshots = resultObj.snapshots;
                                window += "\n"+snapshots[0]['name'];
                                console.log(snapshots);

                                // this promise is to wrap the branching of logic
                                // so it could keep the code clean
                                return new Promise((_resolve, _result) => {
                                        // check if we need to delete the oldest snapshot
                                        // to make room for a new one
                                        if (snapshots && snapshots.length >= holdSnapshots) {
                                                // calculate how many we need to delete for old snapshots
                                                var amountOldSnapshotsToDelete = snapshots.length - holdSnapshots + 1;

                                                // begin promise-syncloop here
                                                console.log('Deleting old snapshots to make room for a new one');
                                                mainCall(amountOldSnapshotsToDelete, deleteFn, snapshots)
                                                        .then(() => {
                                                                console.log('Deleted all old snapshots');
                                                                _resolve();     // proceed to next promise
                                                        })
                                                        .catch((err) => {
                                                                console.log(err.message);
                                                                _reject(err); // reject
                                                        });
                                        }
                                        else {
                                                _resolve();     // proceed to next promise
                                        }
                                });
                        })
                        .then((result) => {
                                // its ok to snapshot a droplet now
                                console.log('Snapshotting for droplet (id:' + dropletId + ')');
                                return Promise.retry(3, dgApi.snapshotDroplet.bind(dgApi), 3000, dropletId);
                        })
                        .then((result) => {
                                var rez = '✔ - '+snapshots[0]["name"]+' snapshot successful!';
                                console.log(rez);
                                statCode.push(rez);
                                resolve();      // resolve this task
                        })
                        .catch((err) => {
                                var reg = err.message.match(/([^"\\\\]*|\\\\["\\\\bfnrt\/]|\\\\u[0-9a-f]{4})*/gm);
                                var rez = '❌ - Error  (dropletId: ' + dropletId + ') : ' + reg[23];
                                console.log(rez);
                                statCode.push(rez);
                                resolve(err);   // reject/resolve this task
                        });
        });
}

var datetime = new Date();
if (dropletIds) {
        // wait for each promise-task to finish before executing next one
        mainCall(dropletIds.length, workerFn)
                .then(() => {
                        console.log('all done!');
                        console.log(window);
                        var staat = statCode.toString();
                        const dataSuccess = JSON.stringify({
                          'text': '```digitaloceanbackup \n █▄▄ ▄▀█ █▀▀ █▄▀ █░█ █▀█   █▀▄ █▀█ █▄░█ █▀▀ █ \n █▄█ █▀█ █▄▄ █░█ █▄█ █▀▀   █▄▀ █▄█ █░▀█ ██▄ ▄ \n'+staat.split(",").join("\n")+'``` \n *_TIME : '+datetime+'_* \n\n No further actions required!',
                        });
                        // notify via Google Chat
                        fetch(webhookURL, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json; charset=UTF-8',
                          },
                          body: dataSuccess,
                        }).then((response) => {
                          console.log(response);
                        });
                })
                .catch((err) => {
                        console.log(err.message);

                        const dataFailure = JSON.stringify({
                          'text': '```digitaloceanbackup \n █▄▄ ▄▀█ █▀▀ █▄▀ █░█ █▀█   █▀▀ ▄▀█ █ █░░ █▀▀ █▀▄ █ \n █▄█ █▀█ █▄▄ █░█ █▄█ █▀▀   █▀░ █▀█ █ █▄▄ ██▄ █▄▀ ▄ \n error: '+err.message+'```\n *_TIME : '+datetime+'_* \n\n _Check server log._',
                        });
                        // notify via Google Chat
                        fetch(webhookURL, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json; charset=UTF-8',
                          },
                          body: dataFailure,
                        }).then((response) => {
                          console.log(response);
                        });
                });
}
