import {
    type Context,
    type MiddlewareFn,
} from "https://lib.deno.dev/x/grammy@1.x/mod.ts";
import { createDebug } from "jsr:@grammyjs/debug@0.2.1";
import type {
    KeyOf,
    LocaleNegotiator,
    MessageTypings,
    NegotiatorResult,
    StringWithSuggestions,
    TranslateFunction,
    TranslationVariables,
} from "./types.ts";
import { isValidLocale } from "./utilities.ts";

const debug = createDebug("grammy:i18n");

export interface FormatAdapter<
    MT extends MessageTypings = MessageTypings,
> {
    /**
     * Fallback (default) locale of the instance. This must be set in
     * order to prevent panicking if the requested locale has no message
     * of that key. An error will be thrown in case there was no bundle
     * registered for this fallback locale.
     */
    fallbackLocale: string;
    /**
     * Get the list of locales registered in the adapter.
     */
    getLocales(): string[];

    translate<K extends KeyOf<MT>>(
        locale: string, // this value is supposed to be returned by the locale negotiator
        messageKey: StringWithSuggestions<K>,
        ...args: MT[K]["length"] extends 0 ? []
            : [variables: TranslationVariables<MT[K][number]>]
    ): string;
}

export interface I18nFlavor<MT extends MessageTypings = MessageTypings> {
    i18n: {
        useLocale: (locale: string) => void;
        negotiateLocale: () => Promise<NegotiatorResult>;
    };
    translate: TranslateFunction<MT>;
}

export class I18n<
    C extends Context = Context,
    MT extends MessageTypings = MessageTypings,
> {
    #localeNegotiator: LocaleNegotiator<C>;

    constructor(
        private adapter: FormatAdapter<MT>,
        options?: {
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
        },
    ) {
        if (!isValidLocale(adapter.fallbackLocale)) {
            throw new Error("Must set a valid fallback (default) locale.");
        }

        this.#localeNegotiator = options?.localeNegotiator ??
            ((ctx) => ctx.from?.language_code);
    }

    /**
     * Get the list of locales registered in the adapter.
     */
    getLocales(): string[] {
        return this.adapter.getLocales();
    }

    translate<K extends KeyOf<MT>>(
        locale: string,
        messageKey: StringWithSuggestions<K>,
        ...args: MT[K]["length"] extends 0 ? []
            : [variables: TranslationVariables<MT[K][number]>]
    ): string {
        return this.adapter.translate(locale, messageKey, ...args);
    }

    middleware(): MiddlewareFn<C & I18nFlavor<MT>> {
        const { fallbackLocale } = this.adapter;
        const localeNegotiator = this.#localeNegotiator;

        const withLocale = (locale: string) =>
            this.translate.bind(this, locale) as TranslateFunction<MT>;

        return async function (ctx, next): Promise<void> {
            let translate: TranslateFunction<MT>;

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
                } satisfies I18nFlavor<MT>["i18n"],
            });

            ctx.translate = function <K extends KeyOf<MT>>(
                messageKey: StringWithSuggestions<K>,
                ...args: MT[K]["length"] extends 0 ? []
                    : [variables: TranslationVariables<MT[K][number]>]
            ): string {
                const variables = args[0];
                const merged = {
                    ...variables,
                    // todo: global variables
                } satisfies TranslationVariables;
                return translate(
                    messageKey,
                    ...[merged] as MT[K]["length"] extends 0 ? []
                        : [TranslationVariables<MT[K][number]>],
                );
            };

            await negotiateLocale(); // initial negotiation
            await next();
        };
    }
}
