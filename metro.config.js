// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Exclude server-only directories from Metro bundling (root-level only)
const projectRoot = __dirname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  new RegExp(`${projectRoot}/scripts/.*`),
  new RegExp(`${projectRoot}/pipeline/.*`),
  new RegExp(`${projectRoot}/scrapers/.*`),
  new RegExp(`${projectRoot}/supabase/.*`),
  new RegExp(`${projectRoot}/logs/.*`),
];

module.exports = config;
