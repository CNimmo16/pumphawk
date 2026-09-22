module.exports = function (api) {
  api.cache(true);
  // Expo configures the Reanimated/Worklets transform for the installed SDK.
  return { presets: ["babel-preset-expo"] };
};
