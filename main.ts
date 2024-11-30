import {
    I18n,
    I18nFlavor,
    MessageTypings,
    TranslationVariables,
} from "./i18n.ts";
import { Bot, Context } from "https://deno.land/x/grammy@v1.31.3/mod.ts";

// const TYPES = {
//     "key": [],
//     "key.attr": [],
// } as const satisfies MessageTypings;

import { GeneratedMessageTypes } from "./kek.ts";

const instance = new I18n<
    Context,
    GeneratedMessageTypes
>({
    fallbackLocale: "en",
});
type StringWithSuggestions<S extends string> =
    | string & Record<never, never>
    | S;
type KeyOf<T> = string & keyof T;
type A = KeyOf<MessageTypings>;
type B = KeyOf<GeneratedMessageTypes>;
type C = string extends B ? true : false;
type D = StringWithSuggestions<KeyOf<GeneratedMessageTypes>>;
type K = TranslationVariables<GeneratedMessageTypes["message"][number]>;
type K2 = GeneratedMessageTypes["maker"][number];
instance.translate(
    "en",
    "maker",
    {},
);
instance.translate(
    "en",
    "message",
    {},
);
instance.translate(
    "en",
    "messagexx",
    {},
);

const instance2 = new I18n<
    Context
>({
    fallbackLocale: "en",
});
console.log(instance2.translate("en", "message", { t: 1 }));
instance2.translate("en", "maker", { k: "" });
instance2.translate("en", "mak");

new Bot<Context & I18nFlavor>("").use(instance);
new Bot<Context & I18nFlavor>("").use(instance2);
