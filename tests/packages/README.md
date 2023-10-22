`library` is a package exporting a single library
imported by package `executable`
that builds an executable linked to that library.

`library` has to be published to Redirectory for testing,
which means it must have a GitHub project with the same name.
I already have an empty `zlib` project on GitHub
that I've been using for these tests.
I reuse that project for `library`
by setting its name to `zlib` in just the Conan recipe.
