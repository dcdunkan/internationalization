import { Context } from "https://deno.land/x/grammy@v1.36.0/mod.ts";

type NegotiatorResult = string | undefined;

type Negotiator<C extends Context> =
    | ((ctx: C) => NegotiatorResult)
    | ((ctx: C) => Promise<NegotiatorResult>);

const asyncNeg: Negotiator<Context> = () => {
    return Promise.resolve("en");
};

const syncNeg: Negotiator<Context> = () => {
    return "en";
};

type FnType<C extends Context, N extends Negotiator<C>> = ReturnType<N> extends
    Promise<NegotiatorResult> ? Promise<void>
    : ReturnType<N> extends NegotiatorResult ? void
    : never;

type A = FnType<Context, typeof asyncNeg>;
//   ^?
type B = FnType<Context, typeof syncNeg>;
//   ^?

type TranslateMessages = {
    msg1: { var1: string };
    msg2: { var1: string; var2: string };
    msg3: never; // or {} if you prefer
};

type TranslateFunctionX = <K extends keyof TranslateMessages>(
    key: K,
    ...args: TranslateMessages[K] extends never ? []
        : [variables: TranslateMessages[K]]
) => string;

let translate: TranslateFunctionX = (key: string, ...args: []) {}

// Now you'll get proper autocompletion:
translate("msg1", { var1: "test" }); // OK
translate("msg2", { var1: "a", var2: "b" }); // OK
translate("msg3"); // OK
translate("");
