import { extname } from "jsr:@std/path@^1/extname";
import { exists } from "jsr:@std/fs@^1/exists";
import { yellow } from "jsr:@std/fmt@^1/colors";
import { parseArgs } from "jsr:@std/cli@^1/parse-args";
import { getFiles, resolveArgument, updateTypes } from "./generate_types.ts";
import { log } from "../common.ts";

const [subcommand, ...subcommandArgs] = Deno.args;

switch (subcommand) {
    case "generate-types": {
        const { _: _pathArgs, ...args } = parseArgs(subcommandArgs, {
            boolean: ["watch", "quiet"],
            string: ["output"],
            alias: {
                "o": "output",
            },
        });

        const pathArgs = _pathArgs.map((arg) => arg.toString());

        if (args.output == null || args.output.trim().length === 0) {
            log.error(`specify the --output file.`);
            Deno.exit(1);
        } else if (
            pathArgs.length === 0 ||
            pathArgs.every((arg) => arg.trim().length === 0)
        ) {
            log.error(`specify at least one file/directory path to watch.`);
            Deno.exit(1);
        }

        const files = new Set<string>();
        const filepaths: string[] = [];

        for (const arg of pathArgs) {
            const resolved = await resolveArgument(arg);
            log.info(
                yellow(args.watch ? `watching` : `reading`),
                resolved.path,
            );
            for (const file of await getFiles(resolved.path)) {
                files.add(file);
            }
            filepaths.push(resolved.path);
        }

        await updateTypes(args.output, files);
        if (!args.watch) Deno.exit(0);

        const watcher = Deno.watchFs(filepaths, { recursive: true });
        Deno.addSignalListener("SIGINT", () => {
            log.info("closing the file watcher");
            watcher.close();
        });

        for await (const event of watcher) {
            const filepath = event.paths[0];

            // only listen to the events that affects .ftl files.
            if (event.paths.length !== 1 || extname(filepath) !== ".ftl") {
                continue;
            }
            if (
                event.kind !== "create" && event.kind !== "modify" &&
                event.kind !== "remove"
            ) continue;

            switch (event.kind) {
                case "create": {
                    if (files.has(filepath)) continue;
                    const info = await Deno.stat(filepath);
                    if (info.isFile) {
                        files.add(filepath);
                        log.info(yellow(`watching`), filepath);
                    } else {
                        continue;
                    }
                    break;
                }
                case "modify":
                    if (
                        await exists(filepath, { isFile: true }) &&
                        !files.has(filepath)
                    ) {
                        files.add(filepath);
                        log.info(yellow(`watching`), filepath);
                    }
                    break;
                case "remove":
                    if (!files.has(filepath)) continue;
                    files.delete(filepath);
                    log.info(yellow(`stopped watching`), filepath);
                    break;
            }

            await updateTypes(args.output, files);
        }

        break;
    }

    case "":
    case undefined: {
        console.log("i18n cli v0.1");
        break;
    }

    default: {
        log.error("unknown command:", subcommand);
        Deno.exit(1);
    }
}
