#!/usr/bin/env node

/*
 * Copyright 2015 Eric Evans <eevans@wikimedia.org>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

/* An Icinga check script for Cassandra/CQL. */

"use strict";

var cass    = require('cassandra-driver');
var util    = require('util');
var P       = require('bluebird');


P.promisifyAll(cass, { suffix: '_p' });


/**
 * This implements a load-balancing policy designed to defeat all of the usual
 * cleverness associated with Casssandra connection pools.  Given that the 
 * purpose of this script is to validate the query interface of a single node,
 * it is important that we guarantee that only the target node is ever queried.
 */
function ImbalancingPolicy(endpoint) {
    this.endpoint = endpoint;
}

util.inherits(ImbalancingPolicy, cass.policies.loadBalancing.LoadBalancingPolicy);

/** Returns an iterator containing only the target host. */
ImbalancingPolicy.prototype.newQueryPlan = function(keyspace, queryOptions, callback) {
    var self = this;
    var count = 0;
    var hostObj = self.hosts.get(self.endpoint);

    if (!hostObj) {
        callback(new Error('test endpoint not found among discovered hosts'));
    }

    callback(null, {
        next: function() {
            if (count++ > 0) {
                return { done: true };
            }
            return { value: hostObj, done: false };
        }
    });
};


var argv = require('yargs')
    .usage('Usage: $0 -H HOST [-P PORT] [-u USER] [-p PASS]')
    .alias('h', 'help')
    .alias('H', 'host')
    .alias('P', 'port')
    .alias('u', 'username')
    .alias('p', 'password')
    .demand('H')
    .default('P', 9042)
    .describe('H', 'Hostname/IP interface to check')
    .describe('P', 'CQL (native) port number')
    .describe('u', 'Username to authenticate with')
    .describe('p', 'Password to authenticate with')
    .help('h')
    .argv;

var endpoint = argv.host + ':' + argv.port;

var options = {
    keyspace: 'system',
    contactPoints: [ endpoint ],
};

//options.sslOptions = {};    // TODO: do.

if (argv.username && argv.password) {
    options.authProvider = new cass.auth.PlainTextAuthProvider(argv.username, argv.password);
}

options.policies = {
    loadBalancing: new ImbalancingPolicy(endpoint),
};

var client = new cass.Client(options);

var start = process.hrtime();
var connTime = start;
var execTime = start;
var errorLog = [];

/*
 * | return code | service state | host state
 * +-------------+---------------+-----------------------
 * |           0 | OK            | UP
 * |           1 | WARNING       | UP or DOWN/UNREACHABLE
 * |           2 | CRITICAL      | DOWN/UNREACHABLE
 * |           3 | UNKNOWN       | DOWN/UNREACHABLE
 * +-------------+---------------+-----------------------
 *
 * See: http://docs.icinga.org/latest/en/pluginapi.html
 */

var statuses = {
    0: 'OK',
    1: 'WARNING',
    2: 'CRITICAL',
    3: 'UNKNOWN',
};

function asMillis(hrtime) {
    var secs = hrtime[0];
    var nanos = hrtime[1];
    return (nanos / 1e6) + (secs * 1e3);
}

function exit(status) {
    var connect = asMillis(connTime);
    var execute = asMillis(execTime);
    var total = asMillis(process.hrtime(start));
    console.log(
        statuses[status],
        '|',
        'connect=' + ((connect < total) ? connect : 'NaN') + ';',
        'execute=' + ((execute < total) ? execute : 'NaN') + ';'
    );
    errorLog.forEach(function(msg) { console.log(msg); });
    process.exit(status);
}

// Here we go!
client.connect_p()
.then(function() {
    connTime = process.hrtime(connTime);
    return client.execute_p('SELECT host_id FROM system.local LIMIT 1')
    .then(function(r) {
        execTime = process.hrtime(execTime);
        // Query was successful, but something is otherwise wrong.
        if (r.info.queriedHost !== endpoint) {    // Error, wrong host queried!
            errorLog.push('Queried host does not match target (a certain bug!)');
            return 3;
        }
        if (r.rows.length !== 1) {  // Error, wrong number of results!
            errorLog.push('Query returned unexpected number of results');
            return 3;
        }

        // Everything checks out OK.
        return 0;
    });
})
.then(function(status) {
    exit(status);
})
.catch(function(e) {
    errorLog.push('connect(): ' + e.toString());
    exit(2);
});
