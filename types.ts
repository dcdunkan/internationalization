import { Context } from "https://lib.deno.dev/x/grammy@1.x/mod.ts";

export type KeyOf<T> = string & keyof T;
export type StringWithSuggestions<S extends string> =
    | string & Record<never, never>
    | S;

export type NegotiatorResult = string | undefined;
export type LocaleNegotiator<C extends Context> = (
    ctx: C,
) => NegotiatorResult | Promise<NegotiatorResult>;

// VERSION 1
type TranslationVariableValue = string | number | Date;

export type TranslationVariables<K extends string = string> = {
    [key in K]: TranslationVariableValue;
};
export type MessageTypings<
    K extends string = string,
    V extends string = string,
> = {
    readonly [key in K]: Readonly<V[]>;
};
export type TranslateFunction<
    T extends MessageTypings = MessageTypings,
> = <K extends KeyOf<T>>(
    messageKey: StringWithSuggestions<K>,
    ...args: T[K]["length"] extends 0 ? []
        : [variables: TranslationVariables<T[K][number]>]
) => string;

// VERSION 2
type VariableValue = string | number | Date;

type Variables<V extends string = string> = {
    readonly [variable in V]: VariableValue;
};

type Locales<
    L extends string = string,
    M extends string = string,
    V extends string = string,
> = {
    locales: L;
    messages: {
        readonly [locale in L]: {
            readonly [message in M]: {
                readonly [variable in V]: VariableValue;
            };
        };
    };
};

type GLocales = {
    locales: "en" | "de";
    messages: {
        readonly "en": {
            readonly "message": {
                readonly first: VariableValue;
                readonly second: VariableValue;
            };
            readonly "message.one": {
                readonly second: VariableValue;
            };
        };
    };
};

function f<B extends Locales>(v: keyof B) {
}

f<GLocales>("locales");
