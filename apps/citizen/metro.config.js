// Monorepo Metro config.
//
// Without this, Metro cannot see packages/shared and every import of
// @safeher/shared fails — which is exactly the drift the shared package
// exists to prevent. watchFolders lets Metro read it; nodeModulesPaths
// lets it resolve hoisted dependencies from the repo root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
