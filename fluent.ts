import {
    FluentBundle,
    FluentResource,
    type FluentVariable,
    type Message,
} from "npm:@fluent/bundle@0.18.0";
import { negotiateLanguages } from "npm:@fluent/langneg@0.7.0";
import { type Context } from "https://deno.land/x/grammy@v1.24.1/mod.ts";
import { walk, WalkOptions } from "jsr:@std/fs@0.229.3/walk";
import { relative } from "jsr:@std/path@0.225.2/relative";
import { join } from "jsr:@std/path@1.0.0-rc.1/join";
import { SEPARATOR } from "jsr:@std/path@1.0.0-rc.1/constants";
import { resolve } from "jsr:@std/path@0.225.2/resolve";

type KeyOf<T> = string & keyof T;
type MaybePromise<T> = Promise<T> | T;
type StringWithSuggestions<S extends string> =
    | string & Record<never, never>
    | S;

export type FluentPattern = Message["attributes"][string];
export type FluentBundleOptions = ConstructorParameters<typeof FluentBundle>[1];
export type TranslationVariables<K extends string = string> = {
    [key in K]: FluentVariable;
};
export type MessageTypings<
    K extends string = string,
    V extends string = string,
> = {
    readonly [key in K]: Readonly<V[]>;
};
export type LocaleNegotiator<C extends Context> = (
    ctx: C,
) => MaybePromise<unknown>;
export interface ResourceOptions {
    allowOverrides?: boolean;
    bundleOptions?: Partial<FluentBundleOptions>;
}

const DEFAULT_FALLBACK_LOCALE = "en" as const;
const ALLOW_OVERRIDES_BY_DEFAULT = false;

export class I18n<
    C extends Context = Context,
    T extends MessageTypings = MessageTypings,
    U extends KeyOf<T> = StringWithSuggestions<KeyOf<T>>,
> {
    // While FluentBundle-s are capable of being the carrier of more than one
    // language at a time, here each bundle can carry only one language.
    #bundles: Map<string, FluentBundle>;

    constructor(
        private options: {
            /**
             * Fallback (default) locale of the instance. This must be set in order
             * to prevent panicking if the requested locale has no message of that key.
             * An error will be thrown in case there was no bundle registered for this
             * fallback locale.
             */
            fallbackLocale: StringWithSuggestions<
                typeof DEFAULT_FALLBACK_LOCALE
            >;
            /**
             * Custom locale negotiator for utilising external sources or databases for
             * choosing the best possible locale for the user.
             *
             * Default locale negotiator reads the `language_code` of the user from the
             * incoming update. If the `language_code` couldn't be accessed, then returns
             * the configured `fallbackLocale` of the instance.
             */
            localeNegotiator?: LocaleNegotiator<C>;
            /**
             * Bundle options to be used when creating a Fluent bundle. This configuration
             * is added to every bundle (each bundle is for each registered locale). This can
             * be overridden by passing a different set of bundle options when loading a
             * resource.
             *
             * One of the common usage of this option would be to load bundles with
             * `useIsolating` set to false by default, to globally disable the Unicode
             * Isolation done by Fluent, or to install custom Fluent functions.
             */
            bundleOptions?: FluentBundleOptions;
        },
    ) {
        if (!isValidLocale(options.fallbackLocale)) {
            throw new Error(
                "Must set a valid fallback (default) locale.",
            );
        }
        this.#bundles = new Map<string, FluentBundle>();
        this.options.localeNegotiator ??= function (ctx) {
            return ctx.from?.language_code ??
                options.fallbackLocale;
        };
    }

    loadResource(
        locale: string,
        source: string,
        options?: ResourceOptions,
    ): Error[] {
        if (!isValidLocale(locale)) {
            throw new Error(`The locale ${locale} seems invalid.`);
        }

        // lookup the bundle with the locale, or create a new one.
        const bundle = this.#bundles.has(locale)
            ? this.#bundles.get(locale)
            : new FluentBundle(locale, options?.bundleOptions);
        assert(bundle !== undefined);

        const resource = new FluentResource(source);
        const errors = bundle.addResource(resource, {
            allowOverrides: options?.allowOverrides ??
                ALLOW_OVERRIDES_BY_DEFAULT,
        });

        this.#bundles.set(locale, bundle);
        return errors;
    }

    getLocales(): string[] {
        const locales: string[] = [];
        for (const locale of this.#bundles.keys()) {
            locales.push(locale);
        }
        return locales;
    }

    translate<K extends U>(
        locale: string,
        messageKey: K,
        variables?: TranslationVariables<T[K][number]>,
    ): string {
        const fallbackLocale = this.options.fallbackLocale;
        const fallbackBundle = this.#bundles.get(fallbackLocale);

        if (this.#bundles.size === 0) {
            throw new Error(
                "There are no available locales for translating the message",
            );
        }
        if (
            typeof fallbackBundle === "undefined" ||
            !(fallbackBundle instanceof FluentBundle)
        ) {
            throw new Error(
                `Fallback locale '${fallbackLocale}' has no translation resources.`,
            );
        }

        const key = parseMessageKey(messageKey);

        // Negotiated locale could be either the best possible match for the
        // requested locale or the fallback locale set by the user.
        const [negotiatedLocale] = negotiateLanguages(
            [locale],
            this.getLocales(),
            {
                strategy: "lookup", // "lookup" strategy only returns one locale.
                defaultLocale: fallbackLocale,
            },
        );

        // If the requested locale negotiated into a matching locale other than
        // the set fallback locale.
        if (negotiatedLocale !== fallbackLocale) {
            const bundle = this.#bundles.get(negotiatedLocale)!;
            const pattern = this.#getPattern(bundle, key);
            if (pattern != null) {
                return this.#formatPattern(bundle, pattern, variables);
            } else {
                console.error(
                    `No message '${messageKey}' found in locale '${negotiatedLocale}'.`,
                );
            }
        }

        // Fallbacking:
        const pattern = this.#getPattern(fallbackBundle, key);

        if (pattern == null) {
            const isAttr = key.attr !== undefined;
            throw new Error(
                `Couldn't find the ` +
                    (isAttr ? `attribute '${key.attr}' in the ` : "") +
                    `message '${key.id}' in the fallback locale '${fallbackLocale}'. ` +
                    `Fallback locale must have all the messages you reference.`,
            );
        }

        return this.#formatPattern(fallbackBundle, pattern, variables);
    }

    #getPattern(
        bundle: FluentBundle,
        key: MessageKey,
    ): FluentPattern | null | undefined {
        const message = bundle.getMessage(key.id);
        return key.attr === undefined
            ? message?.value
            : message?.attributes[key.attr];
    }

    #formatPattern<K extends string>(
        bundle: FluentBundle,
        pattern: FluentPattern,
        variables?: TranslationVariables<K>,
    ): string {
        const errors: Error[] = [];
        const formatted = bundle.formatPattern(
            pattern,
            variables,
            errors,
        );
        for (const error of errors) {
            console.error(error);
        }
        return formatted;
    }
}

export async function loadLocaleDirectory<C extends Context = Context>(
    i18n: I18n<C>,
    path: string,
    options?: {
        walkOptions?: WalkOptions;
        resourceOptions?: ResourceOptions;
    },
): Promise<void> {
}

/**
 * Load locales from a specified directory.
 */
export async function loadLocalesDirectory<C extends Context = Context>(
    i18n: I18n<C>,
    path: string,
    options?: {
        walkOptions?: WalkOptions;
        resourceOptions?: ResourceOptions;
    },
): Promise<void> {
    // TODO: glob pattern support
    const cwd = join(Deno.cwd(), path);
    const walker = walk(path, {
        followSymlinks: true,
        ...(options?.walkOptions ?? {}), // overwrite
        includeDirs: false,
        includeFiles: true,
        exts: [".ftl"],
    });

    for await (const localeDir of Deno.readDir(cwd)) {
        if (!localeDir.isDirectory) continue;
        const path = resolve(cwd, entry.name);
    }

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

const i18n = new I18n({ fallbackLocale: "en" });
await loadLocalesDirectory(i18n, "locales");

interface MessageKey {
    id: string;
    attr?: string;
}

function parseMessageKey(key: string): MessageKey {
    const segments = key.trim().split(".");
    if (
        segments.length > 2 ||
        segments.some((s) => s.trim().length === 0)
    ) {
        throw new Error("Invalid message key segments");
    }
    return { id: segments[0], attr: segments[1] };
}

function assert(expression: unknown, msg?: string): asserts expression {
    if (!expression) {
        throw new Error(msg ?? "Expression isn't truthy");
    }
}

// TODO: Implement a IETF tag validator
function isValidLocale(locale: string): boolean {
    if (typeof locale !== "string") return false;
    return !(/[^a-zA-Z0-9\-]/.test(locale));
}
