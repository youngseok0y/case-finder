console.log(JSON.stringify({
  role: "child-script",
  execPath: process.execPath,
  argv: process.argv.slice(2),
}));
