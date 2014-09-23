var fs = require('fs');
var path = require('path');
var url = require('url');
var semver = require('semver');
var http = require('http');
var https = require('https');
var baseDir = process.env.BASE_DIR || path.resolve(process.env.HOME, '.proxy_npm');
var publicRegistry = process.env.PUBLIC_REGISTRY || "https://registry.npmjs.org";
var publicHost = publicRegistry.replace('http:\/\/', '').replace('https:\/\/', '');

console.log('publicHost: ' + publicHost);

var createDirIfMissing = function(dir) {
    try {
        fs.statSync(dir);
    }
    catch (e) {
        fs.mkdirSync(dir);
    }
};

// Check to see if we have this directory by name.
var requestPathMatchesOurData = function(pathSegments) {
    console.log('requestPathMatchesOurData -> pathSegments: ' + pathSegments);
    var pkgFolder = path.resolve(baseDir, pathSegments);
    try {
        fs.statSync(pkgFolder);
        return true;
    }
    catch(e) {
        return false;
    }
};

var savePackage = function(name, version, tar) {
    var pkgFolder = path.resolve(baseDir, name);
    var versionFolder = path.resolve(pkgFolder, version);
    createDirIfMissing(pkgFolder);
    createDirIfMissing(versionFolder);
    fs.writeFileSync(path.join(versionFolder, 'package.tgz'), tar);
};

var getPackage = function(name, version) {
    var pkgFolder = path.resolve(baseDir, name);

    if (!version) {
        // Get the highest version and return it.
        var files = fs.readdirSync(pkgFolder);
        var mostRecentVersion = '0.0.0';
        for (var i = 0; i < files.length; i++) {
            if (semver.valid(files[i])) {
                console.log('Comparing versions - file:' + files[i] + ' - mostRecentVersion: ' + mostRecentVersion);
                if (semver.gt(files[i], mostRecentVersion)) {
                    mostRecentVersion = files[i];
                }
            }
        }
        version = mostRecentVersion;
    }

    console.log('Version:' + version);

    try {
        // Just checking to see that the requested version exists server side.
        var versionFolder = path.resolve(pkgFolder, version);
        fs.statSync(versionFolder);
        return fs.readFileSync(path.join(versionFolder, 'package.tgz'));
    }
    catch (e) {
        return;
    }
};

//---------------------------------------

createDirIfMissing(baseDir);

http.createServer(function(request, response) {
    var pathSegments = url.parse(request.url).pathname.substring(1, 999);

    console.log('Request.Url: ' + request.url);


    if (requestPathMatchesOurData(pathSegments)) {
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
                var payload = JSON.parse(putData);
                version = payload.versions[Object.keys(payload.versions)[0]].version;
                var tarString = payload['_attachments'][Object.keys(payload['_attachments'])[0]].data;
                console.log('tarString: ' + tarString);
                var tar = new Buffer(tarString, 'base64');
                savePackage(name, version, tar);
                response.statusCode = 200;
                response.end();
            });
            return;
        }
        else if (request.method.toUpperCase() === "GET") {
            console.log('GET - Request.Url: ' + request.url);
            // Need to handle version in the name and or path
            var data = getPackage(name, version);
            if (data) {
                response.write(data, 'binary');
                response.statusCode = 200;
                response.end();
                return;
            }
        }
    }

    if (request.headers.host) {
        request.headers.host = publicHost; //publicRegistry;
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

    if (options.port === 443) {
        httpRequest = https.request(options);
        console.log('https request');
    }
    else {
        httpRequest = http.request(options);
        console.log('http request');
    }

    httpRequest.addListener('response', function (httpResponse) {
    httpResponse.addListener('data', function(chunk) {
        console.log('Chunk read: ' + chunk);
        response.write(chunk, 'binary');
    });

    httpResponse.addListener('end', function() {
        response.end();
    });

    response.writeHead(httpResponse.statusCode, httpResponse.headers);
    });

    request.addListener('data', function(chunk) {
        httpRequest.write(chunk, 'binary');
    });

    request.addListener('end', function() {
        httpRequest.end();
    });
}).listen(process.env.PORT || 8080);
console.log('Listening on port: ' + (process.env.PORT || '8080'));
