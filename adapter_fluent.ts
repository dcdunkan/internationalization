import { createDebug } from "jsr:@grammyjs/debug@0.2.1";
import {
    FluentBundle,
    FluentResource,
    type Message,
} from "npm:@fluent/bundle@0.19.1";
import { negotiateLanguages } from "npm:@fluent/langneg@0.7.0";
import { FormatAdapter } from "./i18n.ts";
import { isValidLocale } from "./utilities.ts";
import type {
    KeyOf,
    MessageTypings,
    StringWithSuggestions,
    TranslationVariables,
} from "./types.ts";

import { walk, type WalkOptions } from "jsr:@std/fs@1/walk";
import { SEPARATOR } from "jsr:@std/path@1/constants";
import { relative } from "jsr:@std/path@1/relative";
import { resolve } from "jsr:@std/path@^1/resolve";

const debug = createDebug("grammy:i18n-fluent");

export type FluentPattern = Message["attributes"][string];
export type FluentBundleOptions = ConstructorParameters<typeof FluentBundle>[1];
export interface ResourceOptions {
    allowOverrides?: boolean;
    bundleOptions?: Partial<FluentBundleOptions>;
}
export interface MessageKey {
    id: string;
    attr?: string;
}

const DEFAULT_ALLOW_OVERRIDES = false;

export class FluentAdapter<MT extends MessageTypings = MessageTypings>
    implements FormatAdapter<MT> {
    // While FluentBundle-s are capable of being the carrier of more than one
    // locales at a time, here each bundle can carry only one locale.
    #bundles: Map<string, FluentBundle>;

    constructor(
        private options: {
            /**
             * Fallback (default) locale of the instance. This must be set in
             * order to prevent panicking if the requested locale has no message
             * of that key. An error will be thrown in case there was no bundle
             * registered for this fallback locale.
             */
            fallbackLocale: string;
            /**
             * Bundle options to be used when creating a Fluent bundle. This
             * configuration is added to every bundle (each bundle is for each
             * registered locale). This can be overridden by passing a different
             * set of bundle options when loading a resource.
             *
             * One of the common usage of this option would be to load bundles
             * with `useIsolating` set to false by default, to globally disable
             * the Unicode Isolation done by Fluent, or to install custom Fluent
             * functions.
             */
            bundleOptions?: FluentBundleOptions;
        },
    ) {
        if (!isValidLocale(options.fallbackLocale)) {
            throw new Error("Must set a valid fallback (default) locale.");
        }

        this.#bundles = new Map<string, FluentBundle>();
        this.options.bundleOptions = options.bundleOptions;
    }

    get fallbackLocale() {
        return this.options.fallbackLocale;
    }

    loadResource(
        locale: string,
        source: string,
        options?: ResourceOptions,
    ): Error[] {
        if (!isValidLocale(locale)) {
            throw new Error(`The locale ${locale} seems invalid.`);
        }

        let bundle: FluentBundle | undefined = this.#bundles.get(locale);
        if (bundle == null || !(bundle instanceof FluentBundle)) {
            bundle = new FluentBundle(locale, { // TODO: should allow multiple locales per bundle? Seems useless in this case
                ...this.options.bundleOptions,
                ...options?.bundleOptions,
            });
            debug(`Creating a bundle for the locale '${locale}'`);
            this.#bundles.set(locale, bundle);
        }

        const resource = new FluentResource(source);
        const errors = bundle.addResource(resource, {
            allowOverrides: options?.allowOverrides ??
                DEFAULT_ALLOW_OVERRIDES,
        });

        return errors;
    }

    getLocales(): string[] {
        const locales: string[] = [];
        for (const bundle of this.#bundles.values()) {
            locales.push(...bundle.locales);
        }
        return locales;
    }

    translate<K extends KeyOf<MT>>(
        locale: string,
        messageKey: StringWithSuggestions<K>,
        ...args: MT[K]["length"] extends 0 ? []
            : [variables: TranslationVariables<MT[K][number]>]
    ): string {
        debug(`Translating message '${messageKey}' in locale '${locale}'`);
        const variables = args[0];

        if (this.#bundles.size == 0) {
            throw new Error(
                "There are no locales available for translating the message",
            );
        }

        const key = parseMessageKey(messageKey);
        const negotiatedLocales = negotiateLanguages(
            [locale],
            this.getLocales(),
            { strategy: "filtering" },
        );
        for (const negotiatedLocale of negotiatedLocales) {
            const bundle = this.#bundles.get(negotiatedLocale);
            if (bundle == null) continue; // TODO: throw or log?
            const pattern = getPattern(bundle, key);
            if (pattern == null) continue;
            debug(
                `Translating using '${negotiatedLocale}' (from '${locale}')`,
            );
            return formatPattern(bundle, pattern, variables);
        }

        // falls back
        debug(`Falling back to '${this.options.fallbackLocale}'`);
        const bundle = this.#bundles.get(this.options.fallbackLocale);
        if (bundle == null) {
            throw new Error(
                "There are no resources available for the fallbackLocale: " +
                    this.options.fallbackLocale,
            );
        }
        const pattern = getPattern(bundle, key);
        if (pattern != null) {
            return formatPattern(bundle, pattern, variables);
        }

        // TODO: decide whether `translate` should throw or return `messageKey` as string.
        throw new Error(
            `Couldn't find the ` +
                (key.attr != null ? `attribute '${key.attr}' in the ` : "") +
                `message '${key.id}' in the fallback locale '${this.options.fallbackLocale}'. ` +
                `At least the fallback locale must have all the messages you reference.`,
        );
    }
}

function getPattern(
    bundle: FluentBundle,
    key: MessageKey,
): FluentPattern | null | undefined {
    const message = bundle.getMessage(key.id);
    return key.attr === undefined
        ? message?.value
        : message?.attributes[key.attr];
}

function formatPattern<K extends string>(
    bundle: FluentBundle,
    pattern: FluentPattern,
    variables?: TranslationVariables<K>,
): string {
    const errors: Error[] = [];
    const formatted = bundle.formatPattern(pattern, variables, errors);
    for (const error of errors) {
        console.error(error);
    }
    return formatted;
}

function parseMessageKey(key: string): MessageKey {
    const segments = key.trim().split(".");
    if (
        segments.length > 2 ||
        segments.some((s) => s.trim().length === 0)
    ) {
        throw new Error(`Invalid message key segments in key: '${key}'`);
    }
    return { id: segments[0], attr: segments[1] };
}

export async function loadLocalesDirectory<
    MT extends MessageTypings = MessageTypings,
>(
    adapter: FluentAdapter<MT>,
    path: string,
    options?: {
        walkOptions?: WalkOptions;
        resourceOptions?: ResourceOptions;
    },
): Promise<void> {
    const cwd = resolve(path);

    for await (const localeDir of Deno.readDir(cwd)) {
        if (!localeDir.isDirectory) continue;

        const path = resolve(cwd, localeDir.name);

        const walker = walk(path, { // TODO: glob pattern support
            followSymlinks: true,
            ...(options?.walkOptions ?? {}), // overwrite
            includeDirs: false,
            includeFiles: true,
            exts: [".ftl"],
        });

        for await (const entry of walker) {
            const resolved = resolve(entry.path);
            const path = relative(cwd, resolved);
            const [locale] = path.split(SEPARATOR);
            const content = await Deno.readTextFile(entry.path);
            const errors = adapter.loadResource(
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
    }

    return;
}
