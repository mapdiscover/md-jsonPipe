const config = require("config");
const merge = require("deepmerge");
const express = require("express");
const server = express.express();
const fs = require("fs");

const scriptname = "MD JsonPipe";
const pluginFolder = process.cwd() + "/" + "plugins";

let plugins = {};

console.debug = (...data) => {
	if (process.env.NODE_ENV === "development") {
		console.log(...data);
	}
}

function getNested(json, path) {
	path = path.split(".");
	for (let key of path) {
		json = json[key];
	}
	return json;
}

function setNested(json, path, value) {
	let objs = [json];
	let keys = [""];
	for (let key of path) {
		objs.push(objs[objs.length-1][key]);
		keys.push(key);
	}
	objs[objs.length-1] = value;
	for (let i = keys.length-1; i < 0; i--) {
		objs
	}
}

function hasNested(json, path) {
	path = path.split(".");
	for (let key of path) {
		if (key in json) {
			json = json[key];
		} else {
			return false;
		}
	}
	return true
}


// Validating required keys in the config
console.log("check if required keys exist in the config ...");
for (let key of ["server", "server.host", "server.port", "pipelines"]) {
	if (!config.has(key)) {
		console.error("JSON Key '" + key + "' is required but does not exist in the config");
		process.exit(10);
	}
}

// Checking existence of the 'plugins' folder
console.log("checking existence of folder '" + pluginFolder + "' ...");
if (!fs.existsSync(pluginFolder)) {
	console.error("Your '" + scriptname + "' instance seems corrupted as the '" + pluginFolder + "' folder doesn't exist in the current path '" + process.cwd() + "'");
	process.exit(20);
}

// Setting up health status endpoint
server.get("/health", (req, res) => {
	res.send("healthy");
});

for (let pipeline of config.get("pipelines")) {
	let steps = config.get("pipelines." + pipeline);

	for (let step of steps) {
		// Checking existence of non-optional keys in 'step'
		if ("plugin" in step) {
			process.exit(11);
		}

		// Checking existence of required plugins needed by step 'step' of pipeline 'pipeline' and load them if necessary
		if (!step.plugin in plugins) {
			if (fs.existsSync(pluginFolder + "/" + step.plugin + ".js")) {
				console.log("load requested and available plugin '" + step.plugin + "' ...");
				plugins[step.plugin] = require(pluginFolder + "/" + step.plugin);
			} else {
				console.log("Requested plugin '" + step.plugin + "' is not available. Please download or copy it into the directory '" + pluginFolder + "' and start this script again!");
				process.exit(30);
			}
		}
	}

	// Setting up pipeline API for 'pipeline'
	server.get("/api/pipeline/" + pipeline, (req, res) => {
		let json = {};
		
		for (let i in steps) {
			console.debug("Executing step " + String(i+1) + "/" + steps.length + " of pipeline '" + pipeline + "' ...");
			
			let stepOutput = {};
			let step = steps[i];
			
			console.debug("  calling plugin '" + step.type + "'")
			if ("options" in step) {
				console.log("    with options ...");
				stepOutput = plugins[step.type].run(step.options);
			} else {
				console.log("    without options ...");
				stepOutput = plugins[step.type].run();
			}

			if ("translation" in step) {
				console.debug("  translating result");
				for (let translator of step.translation) {
					// TODO: Find a way to avoid eval
					if ("replaces" in translator) {
						for (let replacer in translator.replaces) {
							// 'replacer' is a string representing a JSON path like 'foo.bar'
							if ( eval("stepOutput." + replacer) != undefined ) {
								console.debug("    by replacing strings in '" + replacer + "' ...")
								eval("stepOutput." + replacer + " = stepOutput." + replacer + ".replace(\"" + translator.replaces[replacer][1] + "\", \"" + translator.replaces[replacer][1] + "\")");
							} else {
								console.log("    but not in '" + replacer + "' because this JSON path doesn't exist");
							}
						}
					}

					if ("moveJsonPath" in translator && translator.moveJsonPath[0]) {
						console.debug("    by moving a JSON path from '" + translator.moveJsonPath[0] + "' to '" + translator.moveJsonPath[1] + "' ...")
						eval("stepOutput." + translator.moveJsonPath[1] + " = stepOutput." + translator.moveJsonPath[0]);
						eval("delete stepOutput." + translator.moveJsonPath[0]);
					}
				}
			}

			console.debug("  merging result with those from the previous steps ...");
			json = merge(json, stepOutput);
		}

		res.json(json);
	});
}

// Starting JSON web server
server.use( express.json({ extended: false, limit: 500000}) );
server.listen(config.get("server.port"), config.get("server.host"))
