cmake_minimum_required(VERSION 3.5)

project(fastmine LANGUAGES CXX C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

add_executable(fastmine fastmine.cpp sha2.c)

# Require pthread
set(THREADS_PREFER_PTHREAD_FLAG ON)
find_package(Threads REQUIRED)
target_link_libraries(fastmine PRIVATE Threads::Threads)

if (MSVC)
    # warning level 4
    set(CMAKE_CXX_FLAGS "/W4")
    set(CMAKE_C_FLAGS_RELEASE "/O2")
    set(CMAKE_CXX_FLAGS_RELEASE "/O2")
else()
    # lots of warnings
    set(CMAKE_CXX_FLAGS "-Wall -Wextra")
    set(CMAKE_C_FLAGS "-Wall -Wextra")
    set(CMAKE_CXX_FLAGS_RELEASE "-O3 -fomit-frame-pointer")
    set(CMAKE_C_FLAGS_RELEASE "-O3 -fomit-frame-pointer")
    set(CMAKE_CXX_FLAGS_DEBUG "-g")
    set(CMAKE_C_FLAGS_DEBUG "-g")
endif()