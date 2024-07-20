import { I18n } from "./fluent.ts";
import { Context } from "https://deno.land/x/grammy@v1.24.1/context.ts";

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
