import { parse } from "npm:@fluent/syntax@0.19.0";
import { globToRegExp, resolve } from "jsr:@std/path@0.225.2";

function logError(message: string): void {
    console.error(`%cerror%c: ${message}`, "color: red", "color: none");
}

const args = Deno.args;

if (args.length === 0) {
    logError(`provide a filepath as an argument`);
    Deno.exit(1);
}

const filepaths: string[] = [];
for (const [_i, arg] of Deno.args.entries()) {
}

async function resolveArg(arg: string): Promise<string[]> {
    const stat = await Deno.lstat(arg);
    if (stat.isFile) {
        return [resolve(arg)];
    } else if (stat.isDirectory) {
        const filepaths: string[] = [];
        for await (const entry of Deno.readDir(arg)) {
            filepaths.push(resolve(arg, entry.name));
        }
        return filepaths;
    } else if (stat.isSymlink) {
        const resolved = await Deno.readLink(arg);
        return resolveArg(resolved);
    } else {
        throw new Error(
            `'${args}' is not a file, directory, or symlink.`,
        );
    }
}
