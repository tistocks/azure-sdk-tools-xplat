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

var azure = require('azure');
var __ = require('underscore');
var fs = require('fs');

var utils = require('../util/utils.js');
var interaction = require('../util/interaction._js');

var UserInteractor = function(cli) {
  var self = this;
  this.cli = cli;
  this.log = cli.output;
  this.progress = null;

  function logErrorAndData (err, data) {
    interaction.formatOutput(self.cli, data, function(outputData) {
      self.log.error(err);
      interaction.logEachData(self.cli, 'HDInsight Cluster', outputData);
    });
  }

  this.logErrorAndData = logErrorAndData;

  this.checkpoint = function() {};

  function verifyCompat (creationObject, version) {
    if (!creationObject || !creationObject.version || !__.isNumber(creationObject.version)) {
      return false;
    }
    // If the file has a newer version than this library we will not use it.
    if (creationObject.version > version) {
      return false;
    }
    // If the file has the same major version as this library we can use it.
    if (parseInt(creationObject.version, 10) === parseInt(version, 10)) {
      return true;
    }
    // Otherwise the major version of the file is less than this library.
    // That denotes a breaking change in the library and we can not use the file.
    return false;
  }

  this.verifyCompat = verifyCompat;

  function logError (err) {
    interaction.formatOutput(self.cli, err, function() {
      self.log.error(err);
    });
  }

  this.logError = logError;

  function logData (msg, data) {
    interaction.formatOutput(self.cli, data, function(outputData) {
      interaction.logEachData(self.cli, msg, outputData);
    });
  }

  this.logData = logData;

  function logList (list) {
    interaction.formatOutput(self.cli, list, function(outputData) {
      if(outputData.length === 0) {
        self.log.info('No HDInsight clusters exist');
      } else {
        self.log.table(list, function (row, item) {
          row.cell('Name', item.Name);
          row.cell('Location', item.Location);
          row.cell('State', item.State);
        });
      }
    });
  }

  this.logList = logList;

  function promptIfNotGiven (message, value, _) {
    return interaction.promptIfNotGiven(self.cli, message, value, _);
  }

  this.promptIfNotGiven = promptIfNotGiven;

  function startProgress (message) {
    self.progress = self.cli.progress(message);
  }

  this.startProgress = startProgress;

  function endProgress () {
    self.progress.end();
  }

  this.endProgress = endProgress;

  function writeConfig(filePath, config) {
    var data = JSON.stringify(config);
    fs.writeFileSync(filePath, data);
  }

  this.writeConfig = writeConfig;

  function readConfig(filePath) {
    var data = fs.readFileSync(filePath);
    return JSON.parse(data);
  }

  this.readConfig = readConfig;
};

var ExecutionProcessor = function(cli) {
  var self = this;
  this.cli = cli;
  this.errorCount = 0;

  this.validateLocation = function (location, subscriptionId, callback) {
    var hdInsight = self.createHDInsightManagementService(subscriptionId);
    return hdInsight.validateLocation(location, function(err, response) {
      callback(null, response);
    });
  };

  this.registerLocation = function (location, subscriptionId, _) {
    var hdInsight = self.createHDInsightManagementService(subscriptionId);
    return hdInsight.registerLocation(location, _);
  };

  this.filterCluster = function (response) {
    if (self.errorCount > 25) {
      return true;
    }
    if (!response) {
      self.errorCount++;
      return false;
    }
    if (response.State == 'Operational' || response.State == 'Running' || response.State == 'Error' || (response.Error && response.Error != 'None'))  {
      // Diagnostic Log Level
      return true;
    }
    // Diagnostic Log Level
    return false;
  };

  this.filterValidation = function (response) {
    if (self.errorCount > 25) {
      return true;
    }
    if (response && response.statusCode == 200) {
      return true;
    }
    self.errorCount++;
    return false;
  };

  this.createCluster = function (creationObject, subscriptionId, callback) {
    var hdInsight = self.createHDInsightManagementService(subscriptionId);
    return hdInsight.createCluster(creationObject, function(err, response) {
      callback(null, response);
    });
  };

  this.getCluster = function (clusterName, subscriptionId, _) {
    var result = self.listClusters(subscriptionId, _);
    var cluster = result.body.clusters.filter(function (cluster) {
      if (!cluster || !cluster.Name) {
        return false;
      }
      return utils.ignoreCaseEquals(cluster.Name, clusterName);
    })[0];
    return cluster;
  };

  this.deleteCluster = function (clusterName, location, subscriptionId, _) {
    var hdInsight = self.createHDInsightManagementService(subscriptionId);
    hdInsight.deleteCluster(clusterName, location, _);
  };

  this.listClusters = function (subscriptionId, _) {
    var hdInsight = self.createHDInsightManagementService(subscriptionId);
    var result = hdInsight.listClusters(_);

    return result;
  };

  this.createHDInsightManagementService = function (subscription) {
    var account = self.cli.category('account');
    var subscriptionId = account.lookupSubscriptionId(subscription);
    var pem = account.managementCertificate();
    var auth = {
      keyvalue: pem.key,
      certvalue: pem.cert
    };

    return azure.createHDInsightService(subscriptionId, auth);
  };

  this.doPollRequest = function (name, subscriptionId, _) {
    self.errorCount = 0;
    var result = self.getCluster(name, subscriptionId, _);
    var done = self.filterCluster(result);
    while (!done) {
      result = self.getCluster(name, subscriptionId, _);
      done = self.filterCluster(result);
      setTimeout(_, 1000);
    }
  };

  this.doPollValidation = function (location, subscriptionId, _) {
    self.errorCount = 0;
    var result = self.validateLocation(location, subscriptionId, _);
    var done = self.filterValidation(result);
    while (!done) {
      result = self.validateLocation(location, subscriptionId, _);
      done = self.filterValidation(result);
      setTimeout(_, 1000);
    }
  };
};

var hdInsightCommandLine = function(cli, userInteractor, executionProcessor) {
  this.cli = cli;
  this.log = cli.output;
  self = this;
  if (userInteractor) {
    this.user = userInteractor;
  }
  else {
    this.user = new UserInteractor(this.cli);
  }

  if (executionProcessor) {
    this.processor = executionProcessor;
  }
  else {
    this.processor = new ExecutionProcessor(this.cli);
  }

  this.createClusterCommand = function (config, options, _) {
    var params = utils.normalizeParameters({
      config: [config, options.config]
    });

    if (params.err) { throw params.err; }

    var creationObject = { };
    if (params.values.config) {
      creationObject = self.user.readConfig(params.values.config);
    }

    if (options.clusterName) {
      creationObject.name = options.clusterName;
    }
    if (options.nodes) {
      creationObject.nodes = options.nodes;
    }
    if (options.location) {
      creationObject.location = options.location;
    }
    if (options.storageAccountName) {
      creationObject.defaultStorageAccountName = options.storageAccountName;
    }
    if (options.storageAccountKey) {
      creationObject.defaultStorageAccountKey = options.storageAccountKey;
    }
    if (options.storageContainer) {
      creationObject.defaultStorageContainer = options.storageContainer;
    }
    if (options.username) {
      creationObject.user  = options.username;
    }
    if (options.clusterPassword) {
      creationObject.password = options.clusterPassword;
    }

    creationObject.name = self.user.promptIfNotGiven('Cluster name: ', creationObject.name, _);
    creationObject.nodes = parseInt(self.user.promptIfNotGiven('Nodes: ', creationObject.nodes, _), 10);
    creationObject.location = self.user.promptIfNotGiven('Location: ', creationObject.location, _);
    creationObject.defaultStorageAccountName = self.user.promptIfNotGiven('Storage acount name: ', creationObject.defaultStorageAccountName, _);
    creationObject.defaultStorageAccountKey = self.user.promptIfNotGiven('Storage account key: ', creationObject.defaultStorageAccountKey, _);
    creationObject.defaultStorageContainer = self.user.promptIfNotGiven('Storage container: ', creationObject.defaultStorageContainer, _);
    creationObject.user = self.user.promptIfNotGiven('Username: ', creationObject.user, _);
    creationObject.password = self.user.promptIfNotGiven('Password: ', creationObject.password, _);

    self.user.startProgress('Creating HDInsight Cluster');
    var existing = self.processor.getCluster(creationObject.name, options.subscription, _);
    if (existing) {
      self.user.endProgress();
      self.user.logErrorAndData('The requested cluster already exists.', existing);
      return;
    }

    var validate = self.processor.validateLocation(creationObject.location, options.subscription, _);
    if (validate.statusCode == 404) {
      self.processor.registerLocation(creationObject.location, options.subscription, _);
      self.processor.doPollValidation(creationObject.location, options.subscription, _);
    }
    var result = self.processor.createCluster(creationObject, options.subscription, _);
    if (result.statusCode != 202 && result.statusCode != 200) {
      self.user.logError('The cluster could not be created');
      self.user.logError('The request failed. Please contact support for more information.');
      return;
    }
    self.processor.doPollRequest(creationObject.name, options.subscription, _);
    var cluster = self.processor.getCluster(creationObject.name, options.subscription, _);
    self.user.endProgress();
    if (!cluster) {
      self.user.logError('The cluster could not be created');
      self.user.logError('The request failed. Please contact support for more information.');
      return;
    }
    else {
      if (cluster.Error && cluster.Error != 'None') {
        self.user.logErrorAndData('Unable to create cluster.', cluster);
        return;
      }
      else {
        self.user.logData('HDInsight Cluster', cluster);
      }
    }
  };

  this.showClusterCommand = function (clusterName, options, _) {
    var params = utils.normalizeParameters({
      clusterName: [clusterName, options.clusterName]
    });

    if (params.err) { throw params.err; }

    clusterName = self.user.promptIfNotGiven('Cluster name: ', params.values.clusterName, _);
    self.user.startProgress('Getting HDInsight Cluster');
    var cluster = self.processor.getCluster(clusterName, options.subscription, _);
    self.user.endProgress();

    if (!cluster) {
      self.user.logError('Cluster not found');
    }
    else {
      self.user.logData('HDInsight Cluster', cluster);
    }
  };

  this.listClustersCommand = function (options, _) {
    self.user.startProgress('Listing HDInsight Servers');
    var result = self.processor.listClusters(options.subscription, _);
    self.user.endProgress();

    self.user.logList(result.body.clusters);
  };

  this.deleteClusterCommand = function (clusterName, options, _) {
    var params = utils.normalizeParameters({
      clusterName: [clusterName, options.clusterName]
    });

    if (params.err) { throw params.err; }

    clusterName = self.user.promptIfNotGiven('Cluster name: ', params.values.clusterName, _);

    self.user.startProgress('Removing HDInsight Cluster');
    var cluster = self.processor.getCluster(clusterName, options.subscription, _);
    if (cluster) {
      self.processor.deleteCluster(cluster.Name, cluster.Location, options.subscription, _);
    }
    self.user.endProgress();
  };

  var emptyCreationObject = { version : 1.0 };
  this.createConfigCommand = function (filePath, options, _) {
    var params = utils.normalizeParameters({
      filePath: [filePath, options.file]
    });

    if (params.err) { throw params.err; }

    filePath = self.user.promptIfNotGiven('Config File Path: ', params.values.filePath, _);

    var creationObject = emptyCreationObject;
    self.user.writeConfig(filePath, creationObject);
  };

  this.showConfigCommand = function(filePath, options, _) {
    var params = utils.normalizeParameters({
      filePath: [filePath, options.file]
    });

    if (params.err) { throw params.err; }

    filePath = self.user.promptIfNotGiven('Config File Path: ', params.values.filePath, _);

    var creationObject = self.user.readConfig(filePath);
    if (!creationObject) {
      self.user.logError('Could not read config data');
    }
    else {
      self.user.logData('HDInsight Config', creationObject);
    }
  };

  this.setConfigCommand = function (filePath, options, _) {
    var params = utils.normalizeParameters({
      filePath: [filePath, options.file]
    });

    if (params.err) { throw params.err; }

    filePath = self.user.promptIfNotGiven('Config File Path: ', params.values.filePath, _);
    clusterName = self.user.promptIfNotGiven('Cluster name: ', options.clusterName, _);
    nodes = self.user.promptIfNotGiven('Nodes: ', options.nodes, _);
    location = self.user.promptIfNotGiven('Location: ', options.location, _);
    storageAccountName = self.user.promptIfNotGiven('Storage acount name: ', options.storageAccountName, _);
    storageAccountKey = self.user.promptIfNotGiven('Storage account key: ', options.storageAccountKey, _);
    storageContainer = self.user.promptIfNotGiven('Storage container: ', options.storageContainer, _);
    username = self.user.promptIfNotGiven('Username: ', options.username, _);
    clusterPassword = self.user.promptIfNotGiven('Password: ', options.clusterPassword, _);

    var creationObject = self.user.readConfig(filePath);
    if (!creationObject) {
      self.user.logError('Could not read config data');
    }
    else {
      if (!self.user.verifyCompat(creationObject, emptyCreationObject.version)) {
        self.user.logError('The version of this configuration is not compatable with this version of the tools.');
      }
      else {
        creationObject.name = clusterName;
        creationObject.location = location;
        creationObject.defaultStorageAccountName = storageAccountName;
        creationObject.defaultStorageAccountKey = storageAccountKey;
        creationObject.defaultStorageContainer = storageContainer;
        creationObject.user = username;
        creationObject.password = clusterPassword;
        creationObject.nodes = parseInt(nodes, 10); // The number of nodes to use
        self.user.writeConfig(filePath, creationObject);
      }
    }
  };

  this.setConfigMetastoreCommand = function (filePath, type, server, database, user, metastorePassword, options, _) {
    var params = utils.normalizeParameters({
      filePath: [filePath, options.file],
      type: [type, options.type],
      server: [server, options.server],
      database: [database, options.database],
      user: [user, options.user],
      password: [metastorePassword, options.metastorePassword]
    });

    if (params.err) { throw params.err; }

    filePath = self.user.promptIfNotGiven('Config File Path: ', params.values.filePath, _);
    type = self.user.promptIfNotGiven('Metastore Type: ', params.values.type, _);
    server = self.user.promptIfNotGiven('Metastore Server: ', params.values.server, _);
    database = self.user.promptIfNotGiven('Metastore Database: ', params.values.database, _);
    user = self.user.promptIfNotGiven('Metastore user: ', params.values.user, _);
    password = self.user.promptIfNotGiven('Metastore password: ', params.values.password, _);

    var creationObject = self.user.readConfig(filePath);
    if (!creationObject) {
      self.user.logError('Could not read config data');
    }
    else {
      if (!self.user.verifyCompat(creationObject, emptyCreationObject.version)) {
        self.user.logError('The version of this configuration is not compatable with this version of the tools.');
      }
      else {
        creationObject[type + 'Metastore'] = {
          server : server,
          database : database,
          user : user,
          password : password
        };
        self.user.writeConfig(filePath, creationObject);
      }
    }
  };

  this.removeConfigMetastoreCommand = function (filePath, type, options, _) {
    var params = utils.normalizeParameters({
      filePath: [filePath, options.file],
      type: [type, options.type]
    });

    if (params.err) { throw params.err; }

    filePath = self.user.promptIfNotGiven('Config File Path: ', params.values.filePath, _);
    type = self.user.promptIfNotGiven('Metastore Type: ', params.values.type, _);

    var creationObject = self.user.readConfig(filePath);
    if (!creationObject) {
      self.user.logError('Could not read config data');
    }
    else {
      if (!self.user.verifyCompat(creationObject, emptyCreationObject.version)) {
        self.user.logError('The version of this configuration is not compatable with this version of the tools.');
      }
      else {
        creationObject[type + 'Metastore'] = undefined;
        self.user.writeConfig(filePath, creationObject);
      }
    }
  };

  this.addConfigStorageCommand = function (filePath, account, key, options, _) {
    var params = utils.normalizeParameters({
      filePath: [filePath, options.file],
      account: [account, options.storageAccountName],
      key: [key, options.storageAccountKey],
    });

    if (params.err) { throw params.err; }

    filePath = self.user.promptIfNotGiven('Config File Path: ', params.values.filePath, _);
    accountName = self.user.promptIfNotGiven('Storage Account Name: ', params.values.account, _);
    key = self.user.promptIfNotGiven('Storage Account Key: ', params.values.key, _);

    var creationObject = self.user.readConfig(filePath);
    if (!creationObject) {
      self.user.logError('Could not read config data');
    }
    else {
      if (!self.user.verifyCompat(creationObject, emptyCreationObject.version)) {
        self.user.logError('The version of this configuration is not compatable with this version of the tools.');
      }
      else {
        var accounts = [];
        if (creationObject.additionalStorageAccounts) {
          creationObject.additionalStorageAccounts.forEach(function (account) {
            if (account.name != accountName) {
              accounts.push(account);
            }
          });
        }
        accounts.push({ name : accountName, key : key });
        creationObject.additionalStorageAccounts = accounts;
        self.user.writeConfig(filePath, creationObject);
      }
    }
  };

  this.removeConfigStorageCommand = function (filePath, account, options, _) {
    var params = utils.normalizeParameters({
      filePath: [filePath, options.file],
      account: [account, options.storageAccountName],
    });

    if (params.err) { throw params.err; }

    filePath = self.user.promptIfNotGiven('Config File Path: ', params.values.filePath, _);
    accountName = self.user.promptIfNotGiven('Storage Account Name: ', params.values.account, _);

    var creationObject = self.user.readConfig(filePath);
    if (!creationObject) {
      self.user.logError('Could not read config data');
    }
    else {
      if (!self.user.verifyCompat(creationObject, emptyCreationObject.version)) {
        self.user.logError('The version of this configuration is not compatable with this version of the tools.');
      }
      else {
        var accounts = [];
        if (creationObject.additionalStorageAccounts) {
          creationObject.additionalStorageAccounts.forEach(function (account) {
            if (account.name != accountName) {
              accounts.push(account);
            }
          });
        }
        creationObject.additionalStorageAccounts = accounts;
        self.user.writeConfig(filePath, creationObject);
      }
    }
  };
};

module.exports = hdInsightCommandLine;

hdInsightCommandLine.init = function (cli) {
  var self = new hdInsightCommandLine(cli);

  var hdInsight = self.cli.category('hdinsight')
    .description('Commands to manage your HDInsight accounts');

  var cluster = hdInsight.category('cluster')
    .description('Commands to manage your HDInsight clusters');

  cluster.command('create [config]')
    .description('Create a new cluster')
    .usage('[config] [options]')
    .option('--config <config>', 'The config file for cluster creation')
    .option('--clusterName <clusterName>', 'The HdInsight cluster name')
    .option('--storageAccountName <storageAccountName>', 'The Azure storage account to use for HDInsight storage')
    .option('--storageAccountKey <storageAccountKey>', 'The key to the Azure storage account to use for HDInsight storage')
    .option('--storageContainer <storageContainer>', 'The container in the Azure storage account to use for HDInsight default storage')
    .option('--nodes <nodes>', 'The number of data nodes to use for the cluster')
    .option('--location <location>', 'The Azure location for the cluster')
    .option('--username <username>', 'The user name to use for the cluster')
    .option('--clusterPassword <clusterPassword>', 'The password to use for the cluster')
    .option('-s, --subscription <id>', 'use the subscription id')
    .execute(self.createClusterCommand);

  cluster.command('delete [clusterName]')
    .description('Delete a cluster')
    .usage('<clusterName> [options]')
    .option('--clusterName <clusterName>', 'The HdInsight cluster name')
    .option('-s, --subscription <id>', 'use the subscription id')
    .execute(self.deleteClusterCommand);

  cluster.command('show [clusterName]')
    .description('Display cluster details')
    .usage('<clusterName> [options]')
    .option('--clusterName <clusterName>', 'The HdInsight cluster name')
    .option('-s, --subscription <id>', 'use the subscription id')
    .execute(self.showClusterCommand);

  cluster.command('list')
    .description('Get the list of clusters')
    .option('-s, --subscription <id>', 'use the subscription id')
    .execute(self.listClustersCommand);

  var config = cluster.category('config')
    .description('Commands to manage an HDInsight configuration file');

  config.command('create [file]')
    .usage('[file] [options]')
    .option('--file <path>', 'The path to the config file for cluster creation')
    .description('Creates an HDInsight configuration file')
    .execute(self.createConfigCommand);

  config.command('show [file]')
    .usage('[file] [options]')
    .option('--file <path>', 'The path to the config file for cluster creation')
    .description('Shows the contents of an HDInsight configuration file.')
    .execute(self.showConfigCommand);

  config.command('set [file]')
    .description('Sets the basic parameters for a cluster configuration.')
    .usage('[file] [options]')
    .option('--file <path>', 'The path to the config file for cluster creation')
    .option('--clusterName <clusterName>', 'The HdInsight cluster name')
    .option('--storageAccountName <storageAccountName>', 'The Azure storage account to use for HDInsight storage')
    .option('--storageAccountKey <storageAccountKey>', 'The key to the Azure storage account to use for HDInsight storage')
    .option('--storageContainer <storageContainer>', 'The container in the Azure storage account to use for HDInsight default storage')
    .option('--nodes <nodes>', 'The number of data nodes to use for the cluster')
    .option('--location <location>', 'The Azure location for the cluster')
    .option('--username <username>', 'The user name to use for the cluster')
    .option('--clusterPassword <clusterPassword>', 'The password to use for the cluster')
    .execute(self.setConfigCommand);

  var storage = config.category('storage')
    .description('Commands to manage the storage acounts in a configuration file');

  storage.command('add [file] [storageAccountName] [storageAccountKey]')
    .description('Adds a storage account to the cluster configuration.')
    .usage('[file] [storageAccountName] [storageAccountKey] [options]')
    .option('--storageAccountName <storageAccountName>', 'The Azure storage account to use for HDInsight storage')
    .option('--storageAccountKey <storageAccountKey>', 'The key to the Azure storage account to use for HDInsight storage')
    .execute(self.addConfigStorageCommand);

  storage.command('remove [file] [storageAccountName]')
    .description('Removes a storage account to the cluster configuration.')
    .usage('[file] [storageAccountName] [options]')
    .option('--storageAccountName <storageAccountName>', 'The Azure storage account to use for HDInsight storage')
    .execute(self.removeConfigStorageCommand);

  var metastore = config.category('metastore')
    .description('Commands to manage the metastore acounts in a configuration file');

  metastore.command('set [file] [metastoreType] [server] [database] [user] [metastorePassword]')
    .description('Sets a metastore in the cluster configuration.')
    .usage('[file] [metastoreType] [server] [database] [user] [metastorePassword] [options]')
    .option('--type <metastoreType>', 'The type of metastore to set. (example: hive, oozie)')
    .option('--server <server>', 'The name of the sql server for the metastore')
    .option('--database <database>', 'The name of the database on the sql server')
    .option('--user <userName>', 'The user name to use when connecting to the sql server')
    .option('--metastorePassword <metastorePassword>', 'The password to use when connecting to the sql server')
    .execute(self.setConfigMetastoreCommand);

  metastore.command('clear [file] [metastoreType]')
    .description('Clears a metastore in the cluster configuration.')
    .usage('[file] [metastoreType] [options]')
    .option('--type <metastoreType>', 'The type of metastore to clear. (example: hive, oozie)')
    .execute(self.clearConfigMetastoreCommand);
};