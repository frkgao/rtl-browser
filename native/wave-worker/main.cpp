// Copyright 2026 Frank Gao. SPDX-License-Identifier: Apache-2.0
#include "fstapi.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <memory>
#include <string>
#include <vector>
#include <map>
#include <set>
#include <limits>

using nlohmann::json;
using Reader = std::unique_ptr<fstReaderContext, decltype(&fstReaderClose)>;

struct Changes {
    uint64_t start, end;
    size_t count = 0;
    size_t bytes = 0;
    bool truncated = false;
    std::map<fstHandle, json> rows;
};

static void change(void* opaque, uint64_t time, fstHandle handle, const unsigned char* value) {
    auto& c = *static_cast<Changes*>(opaque);
    if (time < c.start || time > c.end) return;
    auto& row = c.rows[handle];
    if (!row.empty() && row.back()[0] == std::to_string(time) && row.back()[1] == reinterpret_cast<const char*>(value)) return;
    if (c.count >= 200000 || c.bytes + std::strlen(reinterpret_cast<const char*>(value)) > 8 * 1024 * 1024) { c.truncated = true; return; }
    c.rows[handle].push_back({std::to_string(time), reinterpret_cast<const char*>(value)});
    ++c.count;
    c.bytes += std::strlen(reinterpret_cast<const char*>(value));
}

static uint64_t tick(const json& request, const char* key) {
    const auto text = request.at(key).get<std::string>();
    if (text.empty() || text.find_first_not_of("0123456789") != std::string::npos)
        throw std::runtime_error("invalid timestamp");
    return std::stoull(text);
}

struct EdgeSearch {
    uint64_t cursor;
    int direction;
    std::string kind, previous;
    bool found = false;
    uint64_t time = 0;
};
static void findEdge(void* opaque, uint64_t time, fstHandle, const unsigned char* value) {
    auto& e = *static_cast<EdgeSearch*>(opaque);
    const std::string current(reinterpret_cast<const char*>(value));
    const bool changed = !e.previous.empty() && e.previous != current;
    const bool matches = changed && (e.kind == "any" || (e.kind == "rise" && e.previous == "0" && current == "1") || (e.kind == "fall" && e.previous == "1" && current == "0"));
    if (matches && ((e.direction > 0 && time > e.cursor) || (e.direction < 0 && time < e.cursor)) &&
        (!e.found || (e.direction > 0 ? time < e.time : time > e.time))) {
        e.found = true; e.time = time;
    }
    e.previous = current;
}

int main() {
    try {
        std::string line;
        std::getline(std::cin, line);
        if (line.size() > 65536) throw std::runtime_error("request too large");
        auto req = json::parse(line);
        Reader reader(fstReaderOpen(req.at("path").get<std::string>().c_str()), fstReaderClose);
        if (!reader) throw std::runtime_error("cannot open FST file");
        auto* ctx = reader.get();
        json result;
        if (req.at("op") == "signals" || req.at("op") == "resolve") {
            const bool resolve = req.at("op") == "resolve";
            std::set<std::string> wanted;
            if (resolve) {
                const auto paths = req.at("paths").get<std::vector<std::string>>();
                if (paths.size() > 64) throw std::runtime_error("select at most 64 signals");
                wanted.insert(paths.begin(), paths.end());
            }
            const auto query = req.value("query", std::string());
            const auto offset = req.value("offset", 0u);
            std::vector<std::string> scopes;
            json roots = json::array();
            json signals = json::array();
            size_t matches = 0;
            while (auto* h = fstReaderIterateHier(ctx)) {
                if (h->htyp == FST_HT_SCOPE) {
                    if (scopes.empty()) roots.push_back({{"name", h->u.scope.name}, {"module", h->u.scope.component ? h->u.scope.component : ""}});
                    scopes.emplace_back(h->u.scope.name);
                }
                else if (h->htyp == FST_HT_UPSCOPE) { if (!scopes.empty()) scopes.pop_back(); }
                else if (h->htyp == FST_HT_VAR) {
                    std::string full;
                    for (const auto& s : scopes) full += s + ".";
                    full += h->u.var.name;
                    if (resolve ? !wanted.contains(full) : full.find(query) == std::string::npos) continue;
                    if (matches++ < offset || signals.size() >= 500) continue;
                    signals.push_back({{"handle", h->u.var.handle}, {"path", full},
                        {"scope", scopes}, {"name", h->u.var.name}, {"width", h->u.var.length},
                        {"type", h->u.var.typ}});
                }
            }
            result = {{"signals", signals}, {"total", matches}, {"roots", roots}, {"signalCount", fstReaderGetVarCount(ctx)},
                {"start", std::to_string(fstReaderGetStartTime(ctx))},
                {"end", std::to_string(fstReaderGetEndTime(ctx))},
                {"timescale", fstReaderGetTimescale(ctx)}};
        } else if (req.at("op") == "edge") {
            const auto handle = req.at("handle").get<fstHandle>();
            const auto kind = req.at("kind").get<std::string>();
            const auto direction = req.at("direction").get<int>();
            if ((direction != 1 && direction != -1) || (kind != "any" && kind != "rise" && kind != "fall")) throw std::runtime_error("invalid edge search");
            uint32_t width = 0;
            while (auto* h = fstReaderIterateHier(ctx)) if (h->htyp == FST_HT_VAR && h->u.var.handle == handle) width = h->u.var.length;
            if (!width || width > 65536 || (kind != "any" && width != 1)) throw std::runtime_error("invalid edge signal");
            EdgeSearch search{tick(req,"cursor"), direction, kind, ""};
            fstReaderClrFacProcessMaskAll(ctx); fstReaderSetFacProcessMask(ctx,handle);
            if (!fstReaderIterBlocks(ctx,findEdge,&search,nullptr)) throw std::runtime_error("FST edge search failed");
            result = {{"time", search.found ? json(std::to_string(search.time)) : json(nullptr)}};
        } else if (req.at("op") == "values") {
            Changes changes{tick(req, "start"), tick(req, "end")};
            if (changes.start > changes.end) throw std::runtime_error("invalid time range");
            auto handles = req.at("handles").get<std::vector<fstHandle>>();
            if (handles.size() > 64) throw std::runtime_error("select at most 64 signals");
            // Learn widths before querying values: libfst writes into the caller's buffer.
            std::map<fstHandle, uint32_t> widths;
            while (auto* h = fstReaderIterateHier(ctx))
                if (h->htyp == FST_HT_VAR) widths[h->u.var.handle] = h->u.var.length;
            fstReaderClrFacProcessMaskAll(ctx);
            for (auto h : handles) {
                if (!widths.contains(h) || widths[h] > 65536) throw std::runtime_error("invalid signal handle or width");
                changes.rows[h] = json::array();
                std::vector<char> buffer(std::max<uint32_t>(widths[h], 64) + 1);
                if (auto* value = fstReaderGetValueFromHandleAtTime(ctx, changes.start, h, buffer.data()))
                    changes.rows[h].push_back({std::to_string(changes.start), value});
                fstReaderSetFacProcessMask(ctx, h);
            }
            fstReaderSetLimitTimeRange(ctx, changes.start, changes.end);
            if (!fstReaderIterBlocks(ctx, change, &changes, nullptr)) throw std::runtime_error("FST value read failed");
            json rows = json::array();
            for (auto& [h, values] : changes.rows) rows.push_back({{"handle", h}, {"changes", values}});
            result = {{"rows", rows}, {"truncated", changes.truncated}};
        } else throw std::runtime_error("unknown operation");
        std::cout << json({{"ok", true}, {"data", result}}).dump() << '\n';
    } catch (const std::exception& e) {
        std::cout << json({{"ok", false}, {"error", e.what()}}).dump() << '\n';
        return 1;
    }
}
