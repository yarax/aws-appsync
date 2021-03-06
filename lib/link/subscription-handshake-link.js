"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
/*!
 * Copyright 2017-2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * Licensed under the Amazon Software License (the "License"). You may not use this file except in compliance with the License. A copy of
 * the License is located at
 *     http://aws.amazon.com/asl/
 * or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
var apollo_link_1 = require("apollo-link");
var Paho = require("../vendor/paho-mqtt");
var Client = Paho.Client;
var SubscriptionHandshakeLink = /** @class */ (function (_super) {
    __extends(SubscriptionHandshakeLink, _super);
    function SubscriptionHandshakeLink(subsInfoContextKey) {
        var _this = _super.call(this) || this;
        _this.clientTopics = new Map();
        _this.topicObserver = new Map();
        /**
         * @returns  {Promise<void>}
         */
        _this.disconnectAll = function () {
            var disconnectPromises = Array.from(_this.clientTopics)
                .map(function (_a) {
                var client = _a[0], topics = _a[1];
                return _this.disconnectClient(client, topics);
            });
            return Promise.all(disconnectPromises).then(function () { return undefined; });
        };
        _this.unsubscribeFromTopic = function (client, topic) {
            return new Promise(function (resolve, reject) {
                if (!client.isConnected()) {
                    var topics = _this.clientTopics.get(client).filter(function (t) { return t !== topic; });
                    _this.clientTopics.set(client, topics);
                    _this.topicObserver.delete(topic);
                    return resolve(topic);
                }
                client.unsubscribe(topic, {
                    onSuccess: function () {
                        var topics = _this.clientTopics.get(client).filter(function (t) { return t !== topic; });
                        _this.clientTopics.set(client, topics);
                        _this.topicObserver.delete(topic);
                        resolve(topic);
                    },
                    onFailure: reject,
                });
            });
        };
        /**
         *
         * @param {Paho.Client} client
         * @param {Set<string>} topics
         */
        _this.disconnectClient = function (client, topics) {
            // console.log(`Unsubscribing from ${topics.length} topics`, topics);
            var unsubPromises = [];
            topics.forEach(function (topic) {
                unsubPromises.push(_this.unsubscribeFromTopic(client, topic));
            });
            return Promise.all(unsubPromises).then(function (_a) {
                // console.log(`Unsubscribed from ${topics.length} topics`, topics);
                var topics = _a.slice(0);
                return new Promise(function (resolve, reject) {
                    if (!client.isConnected()) {
                        return resolve({ client: client, topics: topics });
                    }
                    client.onConnectionLost = function () { return resolve({ client: client, topics: topics }); };
                    client.disconnect();
                });
            });
        };
        /**
         *
         * @param {ZenObservable.Observer} observer
         * @param {[any]} connectionsInfo
         * @returns {Promise<void>}
         */
        _this.connectAll = function (observer, connectionsInfo, lastTopicObserver) {
            if (connectionsInfo === void 0) { connectionsInfo = []; }
            var connectPromises = connectionsInfo.map(_this.connect.bind(_this, observer, lastTopicObserver));
            return Promise.all(connectPromises).then(function () { return undefined; });
        };
        _this.connect = function (observer, lastTopicObserver, connectionInfo) {
            var topics = connectionInfo.topics, clientId = connectionInfo.client, url = connectionInfo.url;
            var client = new Paho.Client(url, clientId);
            // client.trace = console.log.bind(null, clientId);
            client.onMessageArrived = function (_a) {
                var destinationName = _a.destinationName, payloadString = _a.payloadString;
                return _this.onMessage(destinationName, payloadString);
            };
            return new Promise(function (resolve, reject) {
                client.connect({
                    useSSL: url.indexOf('wss://') === 0,
                    mqttVersion: 3,
                    onSuccess: function () { return resolve(client); },
                    onFailure: reject,
                });
            }).then(function (client) {
                client.onConnectionLost = (err) => {
                    console.log('onConnectionLost', err);
                    observer.error(err);
                }
                // console.log(`Doing setup for ${topics.length} topics`, topics);
                var subPromises = topics.map(function (topic) { return new Promise(function (resolve, reject) {
                    client.subscribe(topic, {
                        onSuccess: function () {
                            if (!_this.topicObserver.has(topic)) {
                                _this.topicObserver.set(topic, lastTopicObserver.get(topic) || observer);
                            }
                            resolve(topic);
                        },
                        onFailure: reject,
                    });
                }); });
                return Promise.all(subPromises).then(function (_a) {
                    // console.log('All topics subscribed', topics);
                    var topics = _a.slice(0);
                    _this.clientTopics.set(client, topics);
                    return { client: client, topics: topics };
                });
            });
        };
        _this.onMessage = function (topic, message) {
            var parsedMessage = JSON.parse(message);
            var observer = _this.topicObserver.get(topic);
            // console.log(topic, parsedMessage);
            try {
                observer.next(parsedMessage);
            }
            catch (err) {
                // console.error(err);
            }
        };
        _this.subsInfoContextKey = subsInfoContextKey;
        return _this;
    }
    SubscriptionHandshakeLink.prototype.request = function (operation) {
        var _this = this;
        var _a = this.subsInfoContextKey, subsInfo = operation.getContext()[_a];
        var _b = subsInfo.extensions.subscription, newSubscriptions = _b.newSubscriptions, mqttConnections = _b.mqttConnections;
        var newTopics = Object.keys(newSubscriptions).map(function (subKey) { return newSubscriptions[subKey].topic; });
        var prevTopicsSet = new Set(this.topicObserver.keys());
        var newTopicsSet = new Set(newTopics);
        var lastTopicObserver = new Map(this.topicObserver);
        var connectionsInfo = mqttConnections.map(function (connInfo) {
            var connTopics = connInfo.topics;
            var topicsForClient = new Set(connTopics.filter(function (x) { return prevTopicsSet.has(x); }).concat(connTopics.filter(function (x) { return newTopicsSet.has(x); })));
            return __assign({}, connInfo, { topics: Array.from(topicsForClient.values()) });
        }).filter(function (connInfo) { return connInfo.topics.length; });
        return new apollo_link_1.Observable(function (observer) {
            Promise.resolve()
                // Disconnect existing clients, wait for them to disconnect
                .then(_this.disconnectAll)
                // Connect to all topics
                .then(_this.connectAll.bind(_this, observer, connectionsInfo, lastTopicObserver));
            return function () {
                var _a = (Array.from(_this.topicObserver).find(function (_a) {
                    var topic = _a[0], obs = _a[1];
                    return obs === observer;
                }) || [])[0], topic = _a === void 0 ? undefined : _a;
                var _b = (Array.from(_this.clientTopics).find(function (_a) {
                    var client = _a[0], t = _a[1];
                    return t.indexOf(topic) > -1;
                }) || [])[0], client = _b === void 0 ? undefined : _b;
                if (client && topic) {
                    _this.unsubscribeFromTopic(client, topic).then(function () {
                        var activeTopics = _this.clientTopics.get(client) || [];
                        if (!activeTopics.length) {
                            _this.disconnectClient(client, activeTopics);
                        }
                    });
                }
            };
        });
    };
    return SubscriptionHandshakeLink;
}(apollo_link_1.ApolloLink));
exports.SubscriptionHandshakeLink = SubscriptionHandshakeLink;
