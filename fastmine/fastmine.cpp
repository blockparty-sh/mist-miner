#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <mutex>
#include <random>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <type_traits>
#include <vector>

#include "sha2.h"

#if defined(__clang__) || defined(__GNUC__)
#define EXPECT(expr, constant) __builtin_expect(expr, constant)
#else
#define EXPECT(expr, constant) (expr)
#endif

#define LIKELY(bool_expr)   EXPECT(int(bool(bool_expr)), 1)
#define UNLIKELY(bool_expr) EXPECT(int(bool(bool_expr)), 0)

constexpr unsigned MAX_RUNS = 10'000'000;
std::atomic_bool found = false;

struct xorshift32_state {
    uint32_t a;

    explicit constexpr xorshift32_state(uint32_t a) noexcept : a(a) {}
    xorshift32_state() = delete;

    constexpr void shift32() noexcept {
        a ^= a << 13;
        a ^= a >> 17;
        a ^= a << 5;
    }
};

template <typename Container,
          typename = std::enable_if_t<sizeof(typename Container::value_type) == 1>>
std::vector<uint8_t> unhex(const Container& v)
{
    const auto retSize = unsigned(v.size() / 2);
    std::vector<uint8_t> ret(retSize);

    for (unsigned i = 0; i < retSize; ++i) {
        const uint8_t p1 = uint8_t(v[i*2 + 0]);
        const uint8_t p2 = uint8_t(v[i*2 + 1]);
        ret[i] =   uint8_t(( (p1 <= '9' ? p1 - '0' : p1 - 'a' + 10) << 4) & 0xf0)
                 | uint8_t((  p2 <= '9' ? p2 - '0' : p2 - 'a' + 10)       & 0x0f);
    }

    return ret;
}

template <typename Container,
          typename = std::enable_if_t<sizeof(typename Container::value_type) == 1>>
std::string hex(const Container& v)
{
    constexpr std::array<char, 16> chars = {
        '0', '1', '2', '3', '4', '5', '6', '7',                                                    
        '8', '9', 'a', 'b', 'c', 'd', 'e', 'f' 
    };  
    const auto vSize = unsigned(v.size());
    std::string ret(vSize*2, '\0');
    for (unsigned i=0; i<vSize; ++i) {
        ret[i*2 + 0] = chars[(uint8_t(v[i]) >> 4) & 0xf];
        ret[i*2 + 1] = chars[uint8_t(v[i]) & 0x0F];
    }   
 
    return ret;
}

void mine(std::random_device::result_type seed, unsigned difficulty, std::vector<uint8_t> prehash)
{
    constexpr auto kSha256Len = size_t(SHA256_DIGEST_SIZE);
    difficulty = std::min(difficulty, unsigned(kSha256Len));
    const auto prehashLen = prehash.size();
    if (UNLIKELY(prehashLen < 4))
        throw std::runtime_error("Prehash must be at least 4 bytes!");
    std::default_random_engine gen(seed);
    std::uniform_int_distribution<uint32_t> dist(1, std::numeric_limits<uint32_t>::max());

    std::vector<std::uint8_t> solhash(kSha256Len);
    xorshift32_state state(dist(gen));
    // std::cout << state.a << "\n";

    auto * const prehashTail = prehash.data() + (prehashLen-4);

    for (unsigned i = 0; LIKELY(i < MAX_RUNS && !found.load(std::memory_order::memory_order_relaxed)); ++i) {

        // shift the nonce around
        state.shift32();

        prehashTail[0] = (state.a >> 0)  & 0xff;
        prehashTail[1] = (state.a >> 8)  & 0xff;
        prehashTail[2] = (state.a >> 16) & 0xff;
        prehashTail[3] = (state.a >> 24) & 0xff;

        sha256(prehash.data(), prehashLen, solhash.data());
        sha256(solhash.data(), kSha256Len, solhash.data());
        // std::cout << hex(solhash) << "\n";
        for (unsigned d = 0; d < difficulty; ++d) {
            if (solhash[d] != 0x00) {
                // we use goto here to avoid an extra branch below
                goto not_found;
            }
        }
        // solution found, print, then break out of loop
        {
            found = true;
            using UInt8View = std::basic_string_view<uint8_t>;
            const auto hexSuffix = hex(UInt8View(prehashTail, 4));
            const auto hexSolHash = hex(solhash);
            const auto hexPrehash = hex(prehash);
            {
                // ensures the below is synchronized so that reader process
                // doesn't get interleaved results in extremely unlucky cases
                static std::mutex coutMutex;
                std::unique_lock guard(coutMutex);
                std::cout << "FOUND " << hexSuffix << '\n';
                // std::cout << "found " << state.a << "\n";
                std::cout << "SOLHASH " << hexSolHash << '\n';
                std::cout << "PREHASH " << hexPrehash << '\n';
            }
            // std::cout << i << " runs\n";
            break;
        }
    not_found:
        // solution not found, keep looping
        continue;
    }
}

int main(int argc, char * argv[]) {
    if (argc < 2 || !argv[1][0]) {
        std::cerr << "need preimage\n";
        return EXIT_FAILURE;
    }
    if (argc < 3 || !argv[2][0]) {
        std::cerr << "need difficulty\n";
        return EXIT_FAILURE;
    }
    std::vector<uint8_t> prehash = unhex(std::string_view(argv[1]));
    // std::cout << "PREIMAGE " << hex(prehash) << "\n";

    const unsigned difficulty = argv[2][0]-'0';
    // std::cout << "difficulty: " << difficulty << "\n";

    prehash.resize(prehash.size() + 4);

    const auto nThreads = std::thread::hardware_concurrency();
    std::random_device rd;
    std::vector<std::thread> thds;
    thds.reserve(nThreads);
    for (unsigned i=0; i<nThreads; ++i) {
        thds.emplace_back(mine,  rd(), difficulty, prehash);
    }
    for (auto & t : thds) {
        t.join();
    }

    return EXIT_SUCCESS;
}
