cmake_minimum_required(VERSION 3.16)

project(executable LANGUAGES CXX)

find_package(library)

add_executable(executable)
target_sources(executable PRIVATE src/main.cpp)
target_link_libraries(executable PRIVATE library::library)
