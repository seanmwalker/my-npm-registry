var fs = require('fs');
var path = require('path');
var url = require('url');
// var semver = require('semver');
var http = require('http');
var https = require('https');
var moment = require('moment');
var baseDir = process.env.BASE_DIR || path.resolve(process.env.HOME, '.my-npm-registry');
var debugFolder = (process.env.DEBUG_FOLDER || '_debug');
var debugDir = path.join(baseDir, debugFolder);
var publicRegistry = process.env.PUBLIC_REGISTRY || 'https://registry.npmjs.org';
var publicHost = publicRegistry.replace('http:\/\/', '').replace('https:\/\/', '');
var debugMode = false;
var localModuleFolderList = [];

var logDebugInfo = function (msg, file, logToConsole) {
  if (logToConsole) {
    console.log(msg);
  }
  if (debugMode) {
    // pathSegments.replace(/\//ig, '-') .replace(/\\/ig, '-') + '.put.txt'
    fs.appendFileSync(path.join(debugDir, file || 'application-log.txt'), msg + '\r\n');
  }
};

// True we created it, false we did not
var createDirIfMissing = function (dir) {
  try {
    fs.statSync(dir);
    return false;
  } catch (e) {
    fs.mkdirSync(dir);
    return true;
  }
};

var getFirstSegmentFromPath = function (pathSegments) {
  var segments = pathSegments.split('/');
  // Get the first non empty segment
  return segments[0] || segments[1];
};

// Check to see if we have this directory by name.
var requestPathMatchesOurData = function (pathSegments) {
  var pkgFolder = path.resolve(baseDir, pathSegments);
  logDebugInfo('requestPathMatchesOurData -> pkgFolder: ' + pkgFolder);

  if (localModuleFolderList.indexOf(pkgFolder) > -1) {
    // We have something.
    if (pkgFolder === path.resolve(baseDir, getFirstSegmentFromPath(pathSegments))) {
      // This is a folder request / looking for the package.json
      return 'PACKAGE';
    } else {
      // This is looking for the tar file.
      return 'TAR';
    }
  } else {
    logDebugInfo('\trequestPathMatchesOurData has no match.');
  }
  return 'REMOTE';

  /*    try {
          var stats = fs.statSync(pkgFolder);
          logDebugInfo('\trequestPathMatchesOurData found a matching file or folder');

          // This is a package request only
          if (stats.isDirectory())  {
              return 'PACKAGE';
          }
          else {
              return 'TAR';
          }
      }
      catch(e) {
          logDebugInfo('\trequestPathMatchesOurData has no match: ' + e.message + ' ' + e.stack);
      }
      return 'REMOTE';
  */
};

var getTimeStamp = function () {
  return moment().utc().format('YYYY-MM-DDTHH:mm:ss:SSS') + 'Z';
};

var savePackage = function (name, version, payload) {
  var tarString = payload['_attachments'][Object.keys(payload['_attachments'])[0]].data;
  var tar = Buffer.from(tarString, 'base64');

  var pkgFolder = path.resolve(baseDir, name);
  var dashFolder = path.resolve(pkgFolder, '-');
  var isFirstOne = createDirIfMissing(pkgFolder);
  createDirIfMissing(dashFolder);
  var currTimeStamp = getTimeStamp();

  logDebugInfo('currTimeStamp: ' + currTimeStamp);

  // Clean up the object we need to.
  if (isFirstOne) {
    localModuleFolderList.push(pkgFolder);
    // Remove attachments
    payload['_attachments'] = {};

    // Set modified and created time
    payload.time = {};
    payload.time['modified'] = currTimeStamp;
    payload.time['created'] = currTimeStamp;
  } else {
    var currentVersion = payload.versions[version];
    payload = JSON.parse(getPackage(name));
    payload.time['modified'] = currTimeStamp;
    payload.versions[version] = currentVersion;
  }

  // Set modified time and add time / version
  payload.time[version] = currTimeStamp;

  var files = fs.readdirSync(dashFolder);

  if (files.indexOf(name + '-' + version + '.tgz') < 0) {
    // Write the package.json
    fs.writeFileSync(path.join(pkgFolder, 'package.json'), JSON.stringify(payload));
    // Write the filename
    // "tarball": "http://localhost:8080/my-local-module/-/my-local-module-0.0.0.tgz"
    var tarFilePath = path.join(dashFolder, name + '-' + version + '.tgz');
    fs.writeFileSync(tarFilePath, tar);
    localModuleFolderList.push(tarFilePath);
  } else {
    throw new Error('This version of the package has already been published.');
  }
};

var removePackage = function (name, version) {
  var pkgFolder = path.resolve(baseDir, name);
  var dashFolder = path.resolve(pkgFolder, '-');
  var tarFilePath = path.join(dashFolder, name + '-' + version + '.tgz');

  try {
    fs.unlinkSync(tarFilePath);
  } catch (e) {
    throw new Error('This version of the package does not exist yet.');
  }

  localModuleFolderList.splice(localModuleFolderList.indexOf(tarFilePath), 0);
  // Now clean up the package.json.
  var payload = JSON.parse(getPackage(name));
  // Remove the version.
  payload.versions.splice(payload.versions.indexOf(version), 0);
  payload.time.splice(payload.time.indexOf(version), 0);
  // Set the previous version's timestamp as the modified timestamp

  if (Object.keys(payload.time).length > 2) {
    // We still have at least one version, lets get the most recent time and use that for modified time.
    var previousTime = '';
    for (var key in payload.time) {
      if (previousTime < payload.time[key]) {
        previousTime = payload.time[key];
      }
    }
    payload.time['modified'] = previousTime;
    fs.writeFileSync(path.join(pkgFolder, 'package.json'), JSON.stringify(payload));
  } else {
    localModuleFolderList.splice(localModuleFolderList.indexOf(pkgFolder), 0);
    fs.unlinkSync(dashFolder);
    fs.unlinkSync(path.join(pkgFolder, 'package.json'));
    fs.unlinkSync(pkgFolder);
  }
};

var getPackage = function (name) {
  var pkgFile = path.resolve(baseDir, name, 'package.json');
  return fs.readFileSync(pkgFile);
};

var getTarBall = function (pathSegments) {
  try {
    var tarFolder = path.resolve(baseDir, pathSegments);
    // Just checking to see that the requested version exists server side.
    fs.statSync(tarFolder);
    return fs.readFileSync(tarFolder);
  } catch (e) {
    logDebugInfo('Error fetching tgz file: ' + pathSegments + ' ' + e.message + ' ' + e.stack, null, true);
  }
};

var readFilesAndFolderPathsIntoMemory = function () {
  localModuleFolderList = [];

  fs.readdir(baseDir, function (err, files) {
    if (!err) {
      for (var i = 0; i < files.length; i++) {
        if (files[i] !== '.' && files[i] !== '..' && files[i] !== debugFolder) {
          localModuleFolderList.push(path.resolve(baseDir, files[i]));
          var file = files[i];
          // Inside each module folder there is a folder with a dash as it's name. That contains the tar files.
          fs.readdir(path.resolve(baseDir, files[i], '-'), function (err, childFiles) {
            if (!err) {
              for (var z = 0; z < childFiles.length; z++) {
                if (childFiles[z] !== '.' && childFiles[z] !== '..') {
                  localModuleFolderList.push(path.resolve(baseDir, file, '-', childFiles[z]));
                }
              }
            }
          });
        }
      }
    }
    setTimeout(function () {
      console.log(JSON.stringify(localModuleFolderList));
    }, 10000);
  });
};

// ------------------------------------------------------------------------------
// - Start the application code.
// ------------------------------------------------------------------------------

// Setup the debug mode based on the flag
for (var i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--debug') {
    debugMode = true;
    logDebugInfo('******************************   In debug mode    ******************************', null, true);
  }
}

logDebugInfo('publicHost: ' + publicHost, null, true);

createDirIfMissing(baseDir);
createDirIfMissing(debugDir);
readFilesAndFolderPathsIntoMemory();

http.createServer(function (request, response) {
  var pathSegments = url.parse(request.url).pathname.substring(1, 999);

  logDebugInfo('Request.Url: "' + request.url + '"" - request.method: ' + request.method, null, true);

  var name = getFirstSegmentFromPath(pathSegments);
  var version; // TODO: Detect if one is requested, and use it
  if (request.method.toUpperCase() === 'PUT') {
    var putData = '';

    request.on('data', function (chunk) {
      logDebugInfo('Received body data:' + putData);
      putData += chunk.toString();
    });

    request.on('end', function () {
      // empty 200 OK response for now
      logDebugInfo('Done receiving data. Save and respond: \r\n--------------------------------- END PUT ----------------------------\r\n' + putData, name + '.' + request.method + '.txt');
      var payload = JSON.parse(putData);
      version = payload.versions[Object.keys(payload.versions)[0]].version;
      try {
        savePackage(name, version, payload);
        response.statusCode = 200;
        response.end();
      } catch (e) {
        response.statusCode = 500;
        response.write(e.message);
        response.end();
      }
    });
    return;
  } else if (request.method.toUpperCase() === 'DELETE') {
    var deleteData = '';

    request.on('data', function (chunk) {
      logDebugInfo('Received body data:' + deleteData);
      deleteData += chunk.toString();
    });

    request.on('end', function () {
      // empty 200 OK response for now
      logDebugInfo('Done receiving data. Delete and respond: \r\n--------------------------------- END DELETE ----------------------------\r\n' + deleteData, name + '.' + request.method + '.txt');

      console.log('request.url: ' + request.url + ' - deleteData: ' + deleteData);
      /*            var payload = JSON.parse(deleteData);
                  version = payload.versions[Object.keys(payload.versions)[0]].version;
                  try {
                      removePackage(name, version);
                      response.statusCode = 201;
                      response.end();
                  }
                  catch (e) { */
      response.statusCode = 500;
      // response.write(e.message);
      response.end();
      // }
    });
    return;
  } else if (request.method.toUpperCase() === 'GET') {
    var isPackageOrTarRequest = requestPathMatchesOurData(pathSegments);
    logDebugInfo('GET - Request.Url: "' + request.url + '" request type: ' + isPackageOrTarRequest);

    if (isPackageOrTarRequest === 'PACKAGE') {
      var file = getPackage(name);
      if (file) {
        logDebugInfo('Returning file: ' + name + ' ' + file + '.', null, true);

        try {
          response.statusCode = 200;
          response.write(file, 'utf-8');
          response.end();
          console.log('data sent.');
        } catch (e) {
          console.log('PKG Error: ' + (e.message + e.stack || e.toString() || JSON.stringify(e)));
          response.statusCode = 500;
          response.write('PKG Error: ' + (e.message + e.stack || e.toString() || JSON.stringify(e)));
          response.end();
        }
        return;
      } else {
        logDebugInfo('Nothing found for ' + name + ' ' + version + '.', null, true);
      }
    } else if (isPackageOrTarRequest === 'TAR') {
      // Need to handle version in the name and or path
      var data = getTarBall(pathSegments);
      if (data) {
        logDebugInfo('Returning data for ' + pathSegments + ' ' + data + '.', null, true);
        try {
          response.statusCode = 200;
          response.write(data, 'binary');
          response.end();
          console.log('data sent.');
        } catch (e) {
          logDebugInfo('TAR Error: ' + (e.message + e.stack || e.toString() || JSON.stringify(e)), null, true);
          response.statusCode = 500;
          response.write('TAR Error: ' + (e.message + e.stack || e.toString() || JSON.stringify(e)));
          response.end();
        }
        return;
      } else {
        logDebugInfo('Nothing found for ' + pathSegments + '.', null, true);
      }
    }
  }

  if (request.headers.host) {
    request.headers.host = publicHost;
  }

  // Consider overriding the port values with an env variable
  var options = {
    hostname: publicHost,
    port: publicRegistry.substring(0, 5) === 'https' ? 443 : 80,
    path: request.url,
    method: request.method,
    headers: request.headers
  };

  logDebugInfo('Request.Options: ' + JSON.stringify(options));

  var httpRequest;

  var responseFunctions = function (httpResponse) {
    console.log('STATUS: ' + httpResponse.statusCode);
    console.log('HEADERS: ' + JSON.stringify(httpResponse.headers));

    var allData = '';

    httpResponse.on('data', function (chunk) {
      allData += chunk;
      response.write(chunk, 'binary');
    });

    httpResponse.on('end', function () {
      logDebugInfo('-------------------------------- END -----------------------------\r\n' + allData, name + '.' + request.method + '.txt');
      response.end();
    });

    httpResponse.on('close', function () {
      logDebugInfo('-------------------------------- CLOSE -----------------------------\r\n' + allData, name + '.' + request.method + '.txt');
      response.end();
    });

    response.writeHead(httpResponse.statusCode, httpResponse.headers);
  };

  if (options.port === 443) {
    httpRequest = https.request(options, responseFunctions);
  } else {
    httpRequest = http.request(options, responseFunctions);
  }

  request.addListener('data', function (chunk) {
    logDebugInfo('Request data: chunk received: ' + chunk);
    httpRequest.write(chunk, 'binary');
  });

  request.addListener('end', function () {
    logDebugInfo('Request end.');
    httpRequest.end();
  });
}).listen(process.env.PORT || 8080);

console.log('Listening on port: ' + (process.env.PORT || '8080'));
