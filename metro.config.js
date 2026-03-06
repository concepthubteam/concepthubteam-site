// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Exclude server-only directories from Metro bundling
config.resolver.blockList = [
  /scripts\/.*/,
  /pipeline\/.*/,
  /scrapers\/.*/,
  /supabase\/.*/,
  /logs\/.*/,
];

module.exports = config;
