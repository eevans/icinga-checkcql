icinga-checkcql
===============

This script performs a simple query against the system keyspace of a [Cassandra](http://cassandra.apache.org) node. It conforms to [Icinga's](https://www.icinga.org/) [Plugin API](http://docs.icinga.org/latest/en/pluginapi.html), and can be used to perform more robust service checks.

Usage
-----
Install the dependencies.

    $ npm install

Output help.

    $ ./check.js -h
    Usage: /usr/bin/nodejs check.js -H HOST [-P PORT] [-u USER] [-p PASS]

    Options:
       -H, --host      Hostname/IP interface to check                      [required]
       -P, --port      CQL (native) port number                       [default: 9042]
       -u, --username  Username to authenticate with
       -p, --password  Password to authenticate with
       -h, --help      Show help                                            [boolean]

Example invocation:

    $ nodejs check.js -H cassandra.example.net -P 9042 -u cassandra -p s3kr3t
    OK | connect=40.161753; execute=45.530849;

*Note: all timings are in milliseconds.*

Limitations
-----------
Client encryption is not yet supported.