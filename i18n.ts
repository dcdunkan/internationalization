import {
    FluentBundle,
    FluentResource,
    type FluentVariable,
    type Message,
} from "npm:@fluent/bundle@0.19.1";
import { negotiateLanguages } from "npm:@fluent/langneg@0.7.0";
import {
    type Context,
    type MiddlewareFn,
} from "https://lib.deno.dev/x/grammy@1.x/mod.ts";
import { createDebug } from "jsr:@grammyjs/debug@0.2.1";

const debug = createDebug("grammy:i18n");

type KeyOf<T> = string & keyof T;
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

export type NegotiatorResult = string | undefined;
export type LocaleNegotiator<C extends Context> = (
    ctx: C,
) => NegotiatorResult | Promise<NegotiatorResult>;
export interface ResourceOptions {
    allowOverrides?: boolean;
    bundleOptions?: Partial<FluentBundleOptions>;
}
export interface MessageKey {
    id: string;
    attr?: string;
}

export type TranslateFunction<
    T extends MessageTypings = MessageTypings,
> = <K extends KeyOf<T>>(
    messageKey: StringWithSuggestions<K>,
    ...args: T[K]["length"] extends 0 ? []
        : [variables: TranslationVariables<T[K][number]>]
) => string;

export interface I18nFlavor<T extends MessageTypings = MessageTypings> {
    i18n: {
        useLocale: (locale: string) => void;
        negotiateLocale: () => Promise<NegotiatorResult>;
    };
    translate: TranslateFunction<T>;
}

const DEFAULT_ALLOW_OVERRIDES = false;

export class I18n<
    T extends MessageTypings = MessageTypings,
    C extends Context = Context & I18nFlavor<T>,
> {
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
             * Custom locale negotiator for utilising external sources or
             * databases for choosing the best possible locale for the user.
             *
             * The default locale negotiator reads the `language_code` of the
             * user from the incoming update. This default behavior can be
             * overriden by defining a custom locale negotiator.
             *
             * If the locale negotiator does not return a string, the set
             * fallback locale is used instead.
             */
            localeNegotiator?: LocaleNegotiator<C>;
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
        this.options.localeNegotiator ??= (ctx) => ctx.from?.language_code;
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

    translate<K extends KeyOf<T>>(
        locale: string, // this value is supposed to be returned by the locale negotiator
        messageKey: StringWithSuggestions<K>,
        ...args: T[K]["length"] extends 0 ? []
            : [variables: TranslationVariables<T[K][number]>]
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

    middleware(): MiddlewareFn<C & I18nFlavor<T>> {
        const {
            fallbackLocale,
            localeNegotiator,
        } = this.options;
        const withLocale = (locale: string) =>
            this.translate.bind(this, locale) as TranslateFunction<T>;

        return async function (ctx, next): Promise<void> {
            let translate: TranslateFunction<T>;

            function useLocale(locale: string) {
                if (!isValidLocale(locale)) {
                    throw new Error(
                        "Cannot use an invalid locale for translations.",
                    );
                }
                debug(`Using locale '${locale}' for translating`);
                translate = withLocale(locale);
            }
            async function negotiateLocale() {
                const negotiated = await localeNegotiator?.(ctx);
                debug(
                    negotiated == null
                        ? `Could not negotiate a valid language. Falling back to '${fallbackLocale}'`
                        : `Negotiated locale: '${negotiated}'`,
                );
                useLocale(negotiated ?? fallbackLocale);
                return negotiated;
            }

            Object.defineProperty(ctx, "i18n", {
                writable: true,
                value: {
                    useLocale: useLocale,
                    negotiateLocale: negotiateLocale,
                } satisfies I18nFlavor<T>["i18n"],
            });

            ctx.translate = function <K extends KeyOf<T>>(
                messageKey: StringWithSuggestions<K>,
                ...args: T[K]["length"] extends 0 ? []
                    : [variables: TranslationVariables<T[K][number]>]
            ): string {
                const variables = args[0];
                const merged = {
                    ...variables,
                    // todo: global variables
                } satisfies TranslationVariables;
                return translate(
                    messageKey,
                    ...[merged] as T[K]["length"] extends 0 ? []
                        : [TranslationVariables<T[K][number]>],
                );
            };

            await negotiateLocale(); // initial negotiation
            await next();
        };
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

/**
 * A basic IETF tag validator. Doesn't bother about lengths of the subtags, yet.
 *
 * @see https://en.wikipedia.org/wiki/IETF_language_tag#Syntax_of_language_tags
 */
function isValidLocale(locale: string): boolean {
    if (typeof locale !== "string") return false;
    return locale.split("-")
        .map((subtag) => subtag.trim())
        .every((subtag) => subtag.length > 0 && !/[^a-zA-Z0-9]/.test(subtag));
}
