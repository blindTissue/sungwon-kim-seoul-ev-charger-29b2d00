// Lets Metro resolve the shared OpenAPI types/constants in ../shared (linked as @seoul-ev/shared).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.resolve(projectRoot, "../shared")];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
module.exports = config;
