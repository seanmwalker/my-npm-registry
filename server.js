var fs = require('fs');
var path = require('path');
var url = require('url');
var semver = require('semver');
var http = require('http');
var https = require('https');
var moment = require('moment');
var baseDir = process.env.BASE_DIR || path.resolve(process.env.HOME, '.proxy_npm');
var debugDir = path.join(baseDir, 'debug');
var publicRegistry = process.env.PUBLIC_REGISTRY || "https://registry.npmjs.org";
var publicHost = publicRegistry.replace('http:\/\/', '').replace('https:\/\/', '');

console.log('publicHost: ' + publicHost);
console.log('debugDir: ' + debugDir);


// True we created it, false we did not
var createDirIfMissing = function(dir) {
    try {
        fs.statSync(dir);
        return false;
    }
    catch (e) {
        fs.mkdirSync(dir);
        return true;
    }
};

// Check to see if we have this directory by name.
var requestPathMatchesOurData = function(pathSegments) {
    console.log('requestPathMatchesOurData -> pathSegments: ' + pathSegments);
    // "tarball": "http://localhost:8080/my-local-module/-/my-local-module-0.0.0.tgz"
    var segments = pathSegments.split('/');
    // Get the first non empty segment
    var firstSegment = segments[0] || segments[1];
    var pkgFolder = path.resolve(baseDir, firstSegment);
    try {
        fs.statSync(pkgFolder);
        return true;
    }
    catch(e) {
        return false;
    }
};

var savePackage = function(name, version, payload) {
    var tarString = payload['_attachments'][Object.keys(payload['_attachments'])[0]].data;
    var tar = new Buffer(tarString, 'base64');

    var pkgFolder = path.resolve(baseDir, name);
    var dashFolder = path.resolve(pkgFolder, '-');
    var isFirstOne = createDirIfMissing(pkgFolder);
    createDirIfMissing(dashFolder);
    var currTimeStamp = moment().utc().format("YYYY-MM-DDTHH:mm:ss:SSS") + 'Z';
    
    console.log('currTimeStamp: ' + currTimeStamp);

    // Clean up the object we need to.
    if (isFirstOne) {
        // Remove attachments
        payload['_attachments'] = {};

        // Set modified and created time
        payload.time = {};
        payload.time["modified"] = currTimeStamp;
        payload.time["created"] = currTimeStamp;
    }
    else {
        payload = JSON.parse(getPackage(name));
        payload.time["modified"] = currTimeStamp;
    }

    // Set modified time and add time / version
    payload.time[version] = currTimeStamp;

    // Write the package.json
    fs.writeFileSync(path.join(pkgFolder, 'package.json'), JSON.stringify(payload));
    // Write the filename
    // "tarball": "http://localhost:8080/my-local-module/-/my-local-module-0.0.0.tgz"
    fs.writeFileSync(path.join(dashFolder, name + '-' + version + '.tgz'), tar);
};

var getPackage = function(name) {
    var pkgFile = path.resolve(baseDir, name, 'package.json');
    return fs.readFileSync(pkgFile);
};

var getTarBall = function(path) {
    try {
        var tarFolder = path.resolve(baseDir, path);
        // Just checking to see that the requested version exists server side.
        fs.statSync(tarFolder);
        return fs.readFileSync(tarFolder);
    }
    catch (e) {
        return;
    }
};

//---------------------------------------

createDirIfMissing(baseDir);
createDirIfMissing(debugDir);

http.createServer(function(request, response) {
    var pathSegments = url.parse(request.url).pathname.substring(1, 999);

    console.log('Request.Url: ' + request.url);

    var name = pathSegments;
    var version; // TODO: Detect if one is requested, and use it
    if (request.method.toUpperCase() === "PUT") {
        var putData = '';

        request.on('data', function(chunk) {
            console.log("Received body data:" + putData);
            putData += chunk.toString();
        });

        request.on('end', function() {
            // empty 200 OK response for now
            console.log("Done receiving data. Save and respond: " + putData);
            fs.appendFileSync(path.join(debugDir, pathSegments.replace(/\//ig, '-') .replace(/\\/ig, '-') + '.put.txt'), '--------------------------------- END PUT ----------------------------\n' + putData + '\n');
            var payload = JSON.parse(putData);
            version = payload.versions[Object.keys(payload.versions)[0]].version;
            savePackage(name, version, payload);
            response.statusCode = 200;
            response.end();
        });
        return;
    }
    else if (request.method.toUpperCase() === "GET") {
        var isPackageOrTarRequest = requestPathMatchesOurData(pathSegments);
        console.log('GET - Request.Url: ' + request.url);

        if (isPackageOrTarRequest === 'PACKAGE') {
            var file = getPackage(name);
            if (file) {
                console.log('Returning file: %s %s %s', name, version, file);
                try
                {
                    response.statusCode = 200;
                    response.write(data, 'utf-8');
                    response.end();
                    console.log('data sent.');
                }
                catch (e) {
                    console.log('Error: ' + JSON.stringify(e));
                    response.statusCode = 500;
                    response.write('Error: ' + JSON.stringify(e));
                    response.end();
                }
                return;
            }
            else {
                console.log('Nothing found for %s %s.', name, version);
            }
        }
        else if (isPackageOrTarRequest === 'TAR') {
            // Need to handle version in the name and or path
            var data = getTarBall(name, version);
            if (data) {
                console.log('Returning data: %s %s %s', name, version, data);
                try
                {
                    response.statusCode = 200;
                    response.write(data, 'binary');
                    response.end();
                    console.log('data sent.');
                }
                catch (e) {
                    console.log('Error: ' + JSON.stringify(e));
                    response.statusCode = 500;
                    response.write('Error: ' + JSON.stringify(e));
                    response.end();
                }
                return;
            }
            else {
                console.log('Nothing found for %s %s.', name, version);
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

    console.log("Request.Options: " + JSON.stringify(options));

    var httpRequest;

    var responseFunctions = function (httpResponse) {
        console.log('STATUS: ' + httpResponse.statusCode);
        console.log('HEADERS: ' + JSON.stringify(httpResponse.headers));

        var allData = '';

        httpResponse.on('data', function(chunk) {
            allData += chunk;
            response.write(chunk, 'binary');
        });

        httpResponse.on('end', function() {
            //fs.appendFileSync(path.join(debugDir, options.path.replace(/\//ig, '-') .replace(/\\/ig, '-') + '.txt'), '-------------------------------- END -----------------------------\n' + allData + '\n');
            response.end();
        });

        httpResponse.on('close', function() {
            //fs.appendFileSync(path.join(debugDir, options.path.replace(/\//ig, '-') .replace(/\\/ig, '-') + '.txt'), '--------------------------------- CLOSE ----------------------------\n' + allData + '\n');
            response.end();
        });

        response.writeHead(httpResponse.statusCode, httpResponse.headers);

    };

    if (options.port === 443) {
        httpRequest = https.request(options, responseFunctions);
    }
    else {
        httpRequest = http.request(options, responseFunctions);
    }

    request.addListener('data', function(chunk) {
        console.log('Request data: chunk received: ' + chunk);
        httpRequest.write(chunk, 'binary');
    });

    request.addListener('end', function() {
        console.log('Request end.');
        httpRequest.end();
    });

}).listen(process.env.PORT || 8080);

console.log('Listening on port: ' + (process.env.PORT || '8080'));
