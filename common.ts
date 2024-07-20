import { bold, dim, red } from "jsr:@std/fmt@0.225.4/colors";

export function logger(quiet?: boolean) {
    return {
        info: (...data: unknown[]) =>
            !quiet && console.info(dim(new Date().toISOString()), ...data),
        error: (...data: unknown[]) =>
            console.error(red(bold("error:")), ...data),
    };
}
