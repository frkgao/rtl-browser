// SPDX-License-Identifier: Apache-2.0
#include "fstapi.h"
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>

static void require(bool ok, const char* message) {
    if (!ok) throw std::runtime_error(message);
}

int main(int argc, char** argv) {
    if (argc != 2) return 1;
    try {
        const std::filesystem::path dir(argv[1]);
        std::filesystem::create_directories(dir);
        for (const auto pack : {FST_WR_PT_ZLIB, FST_WR_PT_FASTLZ, FST_WR_PT_LZ4}) {
            for (const bool repack : {false, true}) {
                const auto file = dir / (std::to_string(pack) + (repack ? "-repacked.fst" : ".fst"));
                const auto name = file.string();
                auto* writer = fstWriterCreate(name.c_str(), 1);
                require(writer != nullptr, "create FST");
                fstWriterSetPackType(writer, pack);
                fstWriterSetRepackOnClose(writer, repack);
                fstWriterSetScope(writer, FST_ST_VCD_MODULE, "TOP", "TOP");
                const auto signal = fstWriterCreateVar(writer, FST_VT_VCD_WIRE, FST_VD_INPUT, 1, "clock", 0);
                fstWriterSetUpscope(writer);
                for (uint64_t time = 0; time <= 100; ++time) {
                    fstWriterEmitTimeChange(writer, time);
                    fstWriterEmitValueChange(writer, signal, time % 2 ? "1" : "0");
                }
                require(fstWriterClose2(writer) == 0, "close FST writer");
                auto* reader = fstReaderOpen(name.c_str());
                require(reader != nullptr, "open FST reader");
                require(fstReaderGetEndTime(reader) == 100, "end time");
                require(fstReaderGetMaxHandle(reader) == 1, "signal count");
                bool found = false;
                while (auto* item = fstReaderIterateHier(reader)) {
                    if (item->htyp == FST_HT_VAR && std::string(item->u.var.name) == "clock") found = true;
                }
                require(found, "compressed hierarchy");
                char value[16] = {};
                for (const uint64_t time : {0, 1, 49, 50, 99, 100}) {
                    auto* result = fstReaderGetValueFromHandleAtTime(reader, time, signal, value);
                    require(result && std::string(result) == (time % 2 ? "1" : "0"), "waveform value");
                }
                fstReaderClose(reader);
                require(std::filesystem::remove(file), "close and remove FST");
            }
        }
        require(std::filesystem::is_empty(dir), "temporary FST files cleaned up");
        std::filesystem::remove(dir);
        std::cout << "FST compression and repacking round-trip: PASS\n";
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
