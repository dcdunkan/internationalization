import { I18n, I18nFlavor } from "./i18n.ts";
import { Context } from "https://deno.land/x/grammy@v1.30.0/mod.ts";

// const TYPES = {
//     "key": [],
//     "key.attr": [],
// } as const satisfies MessageTypings;

import { GeneratedMessageTypes } from "./kek.ts";

const instance = new I18n<
    Context,
    GeneratedMessageTypes,
    keyof GeneratedMessageTypes
>({
    fallbackLocale: "en",
});
console.log(instance.translate("en", "message", { t: 1 }));
instance.translate("en", "maker", { k: "" });

import { Bot } from "https://deno.land/x/grammy@v1.30.0/mod.ts";

new Bot<Context & I18nFlavor>("").use(instance);
