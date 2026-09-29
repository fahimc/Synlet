import process from "node:process";

const [task = "a later task", command = "this command"] = process.argv.slice(2);
process.stderr.write(
  `NOT_IMPLEMENTED: ${command} is introduced by ${task}; it is not a passing placeholder.\n`,
);
process.exitCode = 2;
