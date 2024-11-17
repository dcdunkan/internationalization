import {
    FluentBundle,
    FluentResource,
    type FluentVariable,
    type Message,
} from "npm:@fluent/bundle@0.18.0";
import { negotiateLanguages } from "npm:@fluent/langneg@0.7.0";
import {
    type Context,
    type MiddlewareFn,
} from "https://deno.land/x/grammy@v1.31.3/mod.ts";

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
export interface MessageKey {
    id: string;
    attr?: string;
}

export interface I18nFlavor {
    // locale: string;
    translate: TranslateFunction;
}
export type TranslateFunction = <K extends string>(
    key: string,
    variables: TranslationVariables<K>,
) => string;

const DEFAULT_FALLBACK_LOCALE = "en" as const;
const DEFAULT_ALLOW_OVERRIDES = false;

/**
 * This class makes it possible to easily include and use different languages
 * for different users of your bot.
 * ```ts
 * const instance = new I18n({ fallbackLocale: "en" });
 * ```
 */
export class I18n<
    C extends Context = Context,
    T extends MessageTypings = MessageTypings,
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
            : new FluentBundle(locale, {
                ...this.options.bundleOptions,
                ...options?.bundleOptions,
            });
        assert(bundle !== undefined);

        const resource = new FluentResource(source);
        const errors = bundle.addResource(resource, {
            allowOverrides: options?.allowOverrides ??
                DEFAULT_ALLOW_OVERRIDES,
        });

        this.#bundles.set(locale, bundle);
        return errors;
    }

    getLocales(): string[] {
        const itr = this.#bundles.keys();
        return Array.from(itr);
    }

    translate<K extends KeyOf<T>>(
        locale: string, // NOTE: this value is supposed to be returned by the locale negotiator
        messageKey: K,
        ...variables: string extends K // no typings installed / generic types
            ? [TranslationVariables?]
            : T[K] extends readonly string[] // its a valid key
                ? T[K][number] extends never ? [] // and there are variables for the key
                : [TranslationVariables<T[K][number]>]
            : []
    ): string {
        const fallbackLocale = this.options.fallbackLocale;
        const fallbackBundle = this.#bundles.get(fallbackLocale);

        if (this.#bundles.size === 0) {
            throw new Error(
                "There are no locales available for translating the message",
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
            const pattern = findPattern(bundle, key);
            if (pattern != null) {
                return formatPattern(bundle, pattern, variables[0]);
            } else {
                console.error(
                    `No message '${messageKey}' found in locale '${negotiatedLocale}'.`,
                );
            }
        }

        // Fallback locale:
        const pattern = findPattern(fallbackBundle, key);

        if (pattern == null) {
            const isAttr = key.attr !== undefined;
            throw new Error(
                `Couldn't find the ` +
                    (isAttr ? `attribute '${key.attr}' in the ` : "") +
                    `message '${key.id}' in the fallback locale '${fallbackLocale}'. ` +
                    `Fallback locale must have all the messages you reference.`,
            );
        }

        return formatPattern(fallbackBundle, pattern, variables[0]);
    }

    middleware(): MiddlewareFn<C & I18nFlavor> {
        const translateFunction: (
            messageKey: StringWithSuggestions<KeyOf<T>>,
            variables?:
                | TranslationVariables<
                    T[StringWithSuggestions<KeyOf<T>>][number]
                >
                | undefined,
        ) => string = this.translate.bind(this, "en");
        return async function (ctx, next): Promise<void> {
            Object.defineProperty(ctx, "i18n", {
                writable: true,
                value: {
                    translate: translateFunction,
                } satisfies I18nFlavor,
            });

            await next();
        };
    }
}

function findPattern(
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
