from conan import ConanFile
from conan.tools.cmake import CMake

class Library(ConanFile):
    name = 'zlib'
    version = '0.1.0'
    default_user = 'github'
    default_channel = 'thejohnfreeman'

    settings = 'os', 'compiler', 'build_type', 'arch'
    options = {'shared': [True, False], 'fPIC': [True, False]}
    default_options = {'shared': False, 'fPIC': True}

    exports_sources = [
        'CMakeLists.txt',
        'include/*',
    ]

    generators = ('CMakeDeps', 'CMakeToolchain')

    def build(self):
        cmake = CMake(self)
        cmake.configure()
        cmake.build()

    def package(self):
        cmake = CMake(self)
        cmake.install()

    def package_info(self):
        self.cpp_info.set_property('cmake_file_name', 'library')
        self.cpp_info.components['library'].set_property('cmake_target_name', 'library::library')
