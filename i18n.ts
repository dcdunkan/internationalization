import {
    type Context,
    type MiddlewareFn,
} from "https://lib.deno.dev/x/grammy@1.x/mod.ts";
import { createDebug } from "jsr:@grammyjs/debug@0.2.1";
import type {
    LocaleNegotiator,
    Locales,
    LocalesTypings,
    MessageKey,
    Messages,
    NegotiatorResult,
    TranslateFunction,
} from "./types.ts";
import { isValidLocale } from "./utilities.ts";

const debug = createDebug("grammy:i18n");

export interface FormatAdapter<
    LT extends LocalesTypings = LocalesTypings,
> {
    /**
     * Fallback (default) locale of the adapter.
     */
    fallbackLocale: string;
    /**
     * Get the list of locales registered in the adapter.
     */
    getLocales(): string[];

    translate<
        L extends Locales<LT>,
        MK extends MessageKey<LT, Messages<LT>>,
    >(
        locale: L,
        messageKey: MK,
        ...args: Messages<LT>[MK] extends never ? []
            : { readonly [variable: string]: unknown } extends Messages<LT>[MK]
                ? [variables?: Messages<LT>[MK]]
            : [variables: Messages<LT>[MK]]
    ): string;
}

export interface I18nFlavor<LT extends LocalesTypings = LocalesTypings> {
    i18n: {
        useLocale: (locale: string) => void;
        negotiateLocale: () => Promise<NegotiatorResult>;
    };
    translate: TranslateFunction<LT>;
}

export class I18n<
    C extends Context = Context,
    LT extends LocalesTypings = LocalesTypings,
> {
    #localeNegotiator: LocaleNegotiator<C>;

    constructor(
        private adapter: FormatAdapter<LT>,
        options?: {
            /**
             * Custom locale negotiator for utilising external sources or
             * databases for choosing the best possible locale for the user.
             *
             * The default locale negotiator reads the `language_code` of the
             * user from the incoming update. This default behavior can be
             * overriden by defining a custom locale negotiator. If the locale
             * negotiator does not return a string, the set fallback locale is
             * used instead.
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

    translate<
        L extends Locales<LT>,
        M extends Messages<LT>,
        MK extends MessageKey<LT, M>,
    >(
        locale: L,
        messageKey: MK,
        ...args: Messages<LT>[MK] extends never ? []
            : { readonly [variable: string]: unknown } extends Messages<LT>[MK]
                ? [variables?: Messages<LT>[MK]]
            : [variables: Messages<LT>[MK]]
    ): string {
        return this.adapter.translate(locale, messageKey, ...args);
    }

    middleware(): MiddlewareFn<C & I18nFlavor<LT>> {
        const { fallbackLocale } = this.adapter;
        const localeNegotiator = this.#localeNegotiator;

        const withLocale = (locale: string) =>
            this.translate.bind(this, locale) as TranslateFunction<LT>;

        return async function (ctx, next): Promise<void> {
            let translate: TranslateFunction<LT>;

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
                } satisfies I18nFlavor<LT>["i18n"],
            });

            ctx.translate = function <
                MK extends MessageKey<LT, Messages<LT>>,
            >(
                messageKey: MK,
                ...args: Messages<LT>[MK] extends never ? []
                    : { readonly [variable: string]: unknown } extends
                        Messages<LT>[MK] ? [variables?: Messages<LT>[MK]]
                    : [variables: Messages<LT>[MK]]
            ): string {
                return translate(messageKey, ...args);
            };

            await negotiateLocale(); // initial negotiation
            await next();
        };
    }
}
