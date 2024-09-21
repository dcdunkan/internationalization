import { bold, dim, red } from "jsr:@std/fmt/colors";

export function getLogger(quiet?: boolean) {
    return {
        info: (...data: unknown[]) =>
            !quiet && console.info(dim(new Date().toISOString()), ...data),
        error: (...data: unknown[]) =>
            console.error(red(bold("error:")), ...data),
    };
}
