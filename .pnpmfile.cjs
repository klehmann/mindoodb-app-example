const fs = require("node:fs");
const path = require("node:path");

// Local development redirect: while unreleased versions of our own
// packages only exist as tarballs in the sibling checkouts
// (../mindoodb-app-sdk, ../mindoodb-view-language), rewrite the
// registry dependencies to those tarballs. On machines without the
// sibling checkouts (CI, fresh clones after the packages are published
// to npm) the tarballs are missing and the registry versions are used
// unchanged.
const LOCAL_TARBALLS = {
  "mindoodb-app-sdk": path.join(__dirname, "..", "mindoodb-app-sdk", "mindoodb-app-sdk-0.0.26.tgz"),
  "mindoodb-view-language": path.join(__dirname, "..", "mindoodb-view-language", "mindoodb-view-language-0.0.14.tgz"),
};

function redirectToLocalTarballs(dependencies) {
  if (!dependencies) return;
  for (const [name, tarball] of Object.entries(LOCAL_TARBALLS)) {
    if (dependencies[name] && fs.existsSync(tarball)) {
      dependencies[name] = `file:${tarball}`;
    }
  }
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      // Covers both the app's own dependencies and transitive ones
      // (e.g. mindoodb-app-sdk pins mindoodb-view-language).
      redirectToLocalTarballs(pkg.dependencies);
      redirectToLocalTarballs(pkg.devDependencies);
      return pkg;
    },
  },
};
