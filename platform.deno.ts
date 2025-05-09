import { type I18n, type ResourceOptions } from "./i18n.ts";
import { walk, type WalkOptions } from "jsr:@std/fs@1/walk";
import { SEPARATOR } from "jsr:@std/path@1/constants";
import { relative } from "jsr:@std/path@1/relative";
import { resolve } from "jsr:@std/path@^1/resolve";

/**
 * Load locales from a specified directory.
 */
export async function loadLocalesDirectory(
    i18n: I18n,
    path: string,
    options?: {
        walkOptions?: WalkOptions;
        resourceOptions?: ResourceOptions;
    },
): Promise<void> {
    // TODO: glob pattern support
    const cwd = resolve(path);
    const walker = walk(path, {
        followSymlinks: true,
        ...(options?.walkOptions ?? {}), // overwrite
        includeDirs: false,
        includeFiles: true,
        exts: [".ftl"],
    });

    // for await (const localeDir of Deno.readDir(cwd)) {
    //     if (!localeDir.isDirectory) continue;
    //     const path = resolve(cwd, entry.name);
    // }

    for await (const entry of walker) {
        const resolved = resolve(entry.path);
        const path = relative(cwd, resolved);
        const [locale] = path.split(SEPARATOR);
        const content = await Deno.readTextFile(entry.path);
        const errors = i18n.loadResource(
            locale,
            content,
            options?.resourceOptions,
        );
        console.log(locale, resolved);
        for (const error of errors) {
            console.error(
                `%cerror:%c ${error.message}\n    at ${resolved}`,
                "color: red",
                "color: none",
            );
        }
    }

    return;
}
