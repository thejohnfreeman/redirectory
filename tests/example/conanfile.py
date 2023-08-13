from conan import ConanFile

class Example(ConanFile):
    requires = ('zlib/1.2.13@github/thejohnfreeman',)
    settings = ('arch', 'os', 'compiler', 'build_type')
    generators = ('CMakeToolchain', 'CMakeDeps')
