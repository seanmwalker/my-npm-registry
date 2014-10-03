#my-npm-registry
===============

A local NPM registry which proxies requests to the public registry if not found within your local registry. No replication or couchDB needed.

You can publish packages to this tool, which intercepts it from going to the public registry. You can also install the packages as well. You simply use the npm command line tool as you normally would. Simply start the tool running, and set this tool's url as your npm clients registry, and you're ready to begin.

##Install
From the command line execute `npm install`. This will add the dependencies, and you are ready to start.

##Run the server
From the command line execute `npm start`. This will start the service listening on its default port. The default port is 8080. You can change the port by setting the environment variable of `PORT` to your chosen port. You can also enable debug mode for very verbos logging by adding the flag of `--debug` to your command line. The information will show up in a variety of files under the $HOME/.my-npm-registry/_debug folder

##Use from the client
This tool is designed to be a proxy for the NPM client. It simply lets anything you try to do go straight through unless it is a put request, or the get request path matches a locally published component.

##Quick client setup to make life easy
From any nix system or gitbash use this
```export npm_config_registry=http://your-ip-or-domain-name:your-port/```

Or from a Windows machine
```set npm_config_registry=http://your-ip-or-domain-name:your-port/```

##Note of caution
Before you publish it's a good idea to check your registry setting like this: `npm config list`. If for any reason the setting for registry is not correct, it could publish your module to another source. If this tool is turned off/stopped then your publish and installs etc won't work until you revert the registry setting or restart this tool.