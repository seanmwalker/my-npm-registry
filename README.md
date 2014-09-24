#my-npm-registry
===============

A local NPM registry which proxies requests to the public registry if not found within your local registry. No replication or couchDB needed.

You can publish packages to this tool, which intercepts it from going to the public registry. You can also install the packages as well. You simply use the npm command line tool as you normally would. Simply start the tool running, and set this tool's url as your npm clients registry, and you're ready to begin.

##Install
From the command line execute `npm install`. This will add the dependencies, and you are ready to start.

##Run the server
From the command line execute `npm start`. This will start the service listening on its default port. The default port is 8080. You can change the port by setting the environment variable of `PORT` to your chosen port.

##Use from the client
This tool is designed to be a proxy for the NPM client. It simply lets anything you try to do go straight through unless it is a put request, or the get request path matches a locally published component.

##Quick client setup to make life easy
From any nix system or gitbash use this
export npm_config_registry=http://your-ip-or-domain-name:your-port/

Or from a Windows machine
set env
