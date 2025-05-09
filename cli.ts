import {
    type Expression,
    parse,
    type PatternElement,
} from "npm:@fluent/syntax@0.19.0";
import { extname } from "jsr:@std/path@^1/extname";
import { resolve } from "jsr:@std/path@^1/resolve";
import { exists } from "jsr:@std/fs@^1/exists";
import { bold, dim, red, yellow } from "jsr:@std/fmt@^1/colors";
import { parseArgs } from "jsr:@std/cli@^1/parse-args";

const { _: _pathArgs, ...args } = parseArgs(Deno.args, {
    boolean: ["watch", "quiet"],
    string: ["output"],
    alias: {
        "o": "output",
    },
});
const pathArgs = _pathArgs.map((arg) => arg.toString());

const log = getLogger(args.quiet);

if (args.output == null || args.output.trim().length === 0) {
    log.error(`specify the --output file.`);
    Deno.exit(1);
} else if (
    pathArgs.length === 0 || pathArgs.every((arg) => arg.trim().length === 0)
) {
    log.error(`specify at least one file/directory path to watch.`);
    Deno.exit(1);
}

const files = new Set<string>();
const filepaths: string[] = [];

for (const arg of pathArgs) {
    const resolved = await resolveArgument(arg);
    log.info(yellow(args.watch ? `watching` : `reading`), resolved.path);
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

async function updateTypes(filepath: string, sources: Set<string>) {
    log.info("regenerating types");
    const generated = await generateTypes(sources, { allowOverride: false });
    const indent = " ".repeat(4);

    let output = `\
// this file is auto-generated. changes made to this file will be overwritten.\n` +
        `export type GeneratedMessageTypes = {`;
    for (const [key, value] of generated.entries()) {
        const list = Array.from(value.placables)
            .map((placeable) => `"${placeable}"`)
            .join(" ");
        output += `\n${indent}"${key}": readonly [${list}];`;
    }
    output += `\n}\n`;
    await Deno.writeTextFile(filepath, output);
    log.info(`updated output file ${resolve(filepath)}`);
}

async function generateTypes(
    files: Set<string>,
    options: { allowOverride: boolean },
) {
    const messages = new Map<string, {
        source: string;
        placables: Set<string>;
    }>();
    for (const file of files) {
        let content: string;
        try {
            content = await Deno.readTextFile(file);
        } catch (err) {
            if (err instanceof Deno.errors.NotFound) {
                files.delete(file);
                log.info(yellow(`stopped watching: file not found`), file);
                continue;
            } else {
                throw err;
            }
        }

        const resource = parse(content, {});
        for (const entry of resource.body) {
            // TODO: introduce errors, from parsing
            if (entry.type !== "Message") continue;

            if (entry.value != null) {
                const expressions = extractExpressions(entry.value.elements);
                const key = entry.id.name;
                if (messages.has(key) && !options.allowOverride) {
                    log.error(
                        `duplicate key: '${key}' was already specified in`,
                        messages.get(key)?.source === file
                            ? `the same file before.`
                            : messages.get(key)?.source +
                                ` but ${file} is trying to override.`,
                    );
                    continue;
                }
                messages.set(key, {
                    source: file,
                    placables: getPlaceables(expressions),
                });
            }

            if (entry.attributes.length > 0) {
                for (const attribute of entry.attributes) {
                    const expressions = extractExpressions(
                        attribute.value.elements,
                    );
                    const key = `${entry.id.name}.${attribute.id.name}`;
                    if (key in messages && !options.allowOverride) {
                        log.error(
                            `duplicate key: '${key}' was already specified in`,
                            messages.get(key)?.source === file
                                ? `the same file before.`
                                : messages.get(key)?.source +
                                    ` but ${file} is trying to override.`,
                        );
                        continue;
                    }
                    messages.set(key, {
                        source: file,
                        placables: getPlaceables(expressions),
                    });
                }
            }
        }
    }
    return messages;
}

function extractExpressions(elements: PatternElement[]): Expression[] {
    return elements
        .filter((element) => element.type === "Placeable")
        .map((element) => element.expression as Expression);
}

function getPlaceables(expressions: Expression[]) {
    let placeables = new Set<string>();
    for (const expression of expressions) {
        switch (expression.type) {
            case "FunctionReference": {
                const args = expression.arguments.positional;
                placeables = placeables.union(getPlaceables(args));
                break;
            }
            case "VariableReference": {
                placeables.add(expression.id.name);
                break;
            }
            case "SelectExpression": {
                const selector = expression.selector;
                if (selector.type === "VariableReference") {
                    placeables.add(selector.id.name);
                }
                break;
            }
        }
    }
    return placeables;
}

async function getFiles(source: string): Promise<string[]> {
    // ignore dot files
    if (source.startsWith(".")) return [];
    const info = await Deno.lstat(source);
    if (info.isFile) {
        if (extname(source) !== ".ftl") return [];
        return [resolve(source)];
    } else if (info.isDirectory) {
        const files: string[] = [];
        for await (const entry of Deno.readDir(source)) {
            const path = resolve(source, entry.name);
            const inside = await getFiles(path);
            files.push(...inside);
        }
        return files;
    } else if (info.isSymlink) {
        const realpath = await Deno.realPath(source);
        return await getFiles(realpath);
    } else {
        log.error(`not file, directory, or symlink.`);
        return [];
    }
}

async function resolveArgument(
    arg: string,
): Promise<{ path: string; dir: boolean }> {
    const file = await Deno.lstat(arg);
    if (file.isFile || file.isDirectory) {
        return { path: resolve(arg), dir: file.isDirectory };
    } else if (file.isSymlink) {
        const resolved = await Deno.readLink(arg);
        return resolveArgument(resolved);
    } else {
        console.error(`'${args}' is not a file, directory, or symlink.`);
        Deno.exit(1);
    }
}

function getLogger(quiet?: boolean) {
    return {
        info: (...data: unknown[]) =>
            !quiet && console.info(dim(new Date().toISOString()), ...data),
        error: (...data: unknown[]) =>
            console.error(red(bold("error:")), ...data),
    };
}
