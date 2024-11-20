const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "nostr-zap-view.js",
    library: "nostrZapView",
    libraryTarget: "umd",
  },
  mode: "production",
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["to-string-loader", "css-loader"],
      },
      {
        test: /\.svg$/,
        type: "asset/inline",
      },
    ],
  },
  resolve: {
    modules: [path.resolve(__dirname, "src"), "node_modules"],
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          format: {
            comments: /@license/i,
          },
          compress: {
            drop_console: true,
          },
        },
        extractComments: false,
      }),
    ],
  },
};
