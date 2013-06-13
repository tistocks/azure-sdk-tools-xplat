/**
* Copyright (c) Microsoft.  All rights reserved.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

var mocha = require('mocha');
var should = require('should');
var _ = require('underscore');

// Test includes
var testutil = require('../util/util');

// Lib includes
var util = testutil.libRequire('util/utils');
var hdInsightCli = require('../../lib/commands/hdinsight._js')

describe('HDInsight command line (under unit test)', function() {
  it('should receive the hdInsight cli object', function(done) {
    should.exist(hdInsightCli.init);
    done();
  });
});