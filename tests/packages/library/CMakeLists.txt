cmake_minimum_required(VERSION 3.16)

project(library LANGUAGES CXX)

add_library(library INTERFACE)
target_include_directories(library INTERFACE
  $<BUILD_INTERFACE:include>
  $<INSTALL_INTERFACE:include>
)

install(TARGETS library EXPORT library.exports)
install(EXPORT library.exports NAMESPACE library:: DESTINATION cmake)
install(DIRECTORY include/ DESTINATION include)
