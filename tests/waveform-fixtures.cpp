// Copyright 2026 Frank Gao. SPDX-License-Identifier: Apache-2.0
#include "fstapi.h"
#include <filesystem>
#include <string>

int main(int argc, char** argv) {
    if (argc != 2) return 1;
    const auto dir = std::filesystem::path(argv[1]);
    std::filesystem::create_directories(dir);
    for (const auto& name : {"wrong-top", "wrong-module", "empty", "multiple-roots"}) {
        const auto file = (dir / (std::string(name) + ".fst")).string();
        auto* ctx = fstWriterCreate(file.c_str(), 1);
        if (!ctx) return 2;
        const std::string mode(name);
        fstWriterSetScope(ctx, FST_ST_VCD_MODULE, mode == "wrong-top" ? "OtherTop" : "TOP", mode == "wrong-module" ? "OtherModule" : "TOP");
        fstHandle signal = 0, other = 0;
        if (mode != "empty") signal = fstWriterCreateVar(ctx, FST_VT_VCD_WIRE, FST_VD_INPUT, 1, "clock", 0);
        fstWriterSetUpscope(ctx);
        if (mode == "multiple-roots") {
            fstWriterSetScope(ctx, FST_ST_VCD_MODULE, "monitor", "monitor");
            other = fstWriterCreateVar(ctx, FST_VT_VCD_WIRE, FST_VD_INPUT, 1, "flag", 0);
            fstWriterSetUpscope(ctx);
        }
        fstWriterEmitTimeChange(ctx, 0);
        if (signal) fstWriterEmitValueChange(ctx, signal, "0");
        if (other) fstWriterEmitValueChange(ctx, other, "0");
        fstWriterEmitTimeChange(ctx, 10);
        if (signal) fstWriterEmitValueChange(ctx, signal, "1");
        if (fstWriterClose2(ctx)) return 3;
    }
}
