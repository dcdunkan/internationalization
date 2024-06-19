import {
    FluentBundle,
    FluentResource,
    type FluentVariable,
    type Message,
} from "npm:@fluent/bundle@0.18.0";
import { negotiateLanguages } from "npm:@fluent/langneg@0.7.0";
import { type Context } from "https://deno.land/x/grammy@v1.24.1/mod.ts";

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

const DEFAULT_FALLBACK_LOCALE = "en" as const;
const ALLOW_OVERRIDES_BY_DEFAULT = false;

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
             * Bundle options to use creating a Fluent bundle. This configuration is added
             * to every bundle (each bundle is for each registered locale). This can be
             * overridden by passing a different set of bundle options when loading a
             * resource.
             *
             * One of the common usage of this option would be to load bundles with
             * `useIsolating` set to false by default, to globally disable the Unicode
             * Isolation done by Fluent:
             * ```ts
             * const i18n = new I18n({
             *     fallbackLocale: ...,
             *     bundleOptions: {
             *         useIsolating: false,
             *         // ...
             *     },
             * });
             * ```
             * or to install custom Fluent functions.
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
        options?: {
            allowOverrides?: boolean;
            bundleOptions?: Partial<FluentBundleOptions>;
        },
    ): void {
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

        for (const error of errors) {
            throw error;
        }

        this.#bundles.set(locale, bundle);
    }

    getLocales(): string[] {
        const locales: string[] = [];
        for (const locale of this.#bundles.keys()) {
            locales.push(locale);
        }
        return locales;
    }

    translate<K extends StringWithSuggestions<KeyOf<T>>>(
        locale: string,
        messageKey: K,
        variables?: TranslationVariables<T[K][number]>,
    ): string {
        const fallbackLocale = this.options.fallbackLocale;
        const availableLocales = this.getLocales();

        if (this.#bundles.size === 0) {
            throw new Error(
                "There are no available locales for translating the message",
            );
        }
        if (!this.#bundles.has(fallbackLocale)) {
            throw new Error(
                `Fallback locale '${fallbackLocale}' has no translation resources.`,
            );
        }

        // "lookup" strategy only returns one locale.
        const [negotiatedLocale] = negotiateLanguages(
            [locale],
            availableLocales,
            {
                strategy: "lookup",
                defaultLocale: fallbackLocale,
            },
        );
        const bundle = this.#bundles.get(negotiatedLocale);
        assert(bundle !== undefined);

        const key = parseMessageKey(messageKey);

        if (bundle.hasMessage(key.id)) {
            const message = bundle.getMessage(key.id);
            assert(message !== undefined && message.value != null);

            if (key.attribute !== undefined) {
                if (message.attributes[key.attribute] != null) {
                    const pattern = message.attributes[
                        key.attribute
                    ];
                    return this.formatPattern(
                        bundle,
                        pattern,
                        variables,
                    );
                } else {
                    throw new Error(
                        `Message attribute '${key.attribute}' not found in ` +
                            `message '${key.attribute}' in the locale '${locale}'`,
                    );
                }
            } else {
                return this.formatPattern(
                    bundle,
                    message.value,
                    variables,
                );
            }
        } else {
            throw new Error(
                `Message '${messageKey}' not found in the locale '${locale}'.`,
            );
        }
    }

    private formatPattern<K extends string>(
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
            throw error;
        }
        return formatted;
    }
}

function parseMessageKey(key: string): { id: string; attribute?: string } {
    const segments = key.trim().split(".");
    if (
        segments.length > 2 ||
        segments.some((s) => s.trim().length === 0)
    ) {
        throw new Error("Invalid message key segments");
    }
    return { id: segments[0], attribute: segments[1] };
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

const TYPES = {
    key1: ["attr1"],
    key2: ["attr2", "attr3"],
} as const;

const instance = new I18n<Context, typeof TYPES>({ fallbackLocale: "en" });
instance.loadResource("en", "hello = 2");
instance.loadResource("en", "hello2 = hello! {$x}");

instance.translate("fr", "non-existent-key");
instance.translate("en", "key1", { attr1: 1 });
instance.translate("en", "key2", { attr2: 4, attr3: 3 });

console.log(instance.translate("en", "hello", { x: "name" }));
console.log(instance);
