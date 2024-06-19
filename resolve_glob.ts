import { globToRegExp, isGlob, normalizeGlob } from "jsr:@std/path@0.225.2";

function resolveGlob(glob: string) {
    if (!isGlob(glob)) {
        throw new Error("the input is not a glob");
    }

    const normalized = normalizeGlob(glob);
}
