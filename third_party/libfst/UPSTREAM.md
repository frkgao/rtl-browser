Source: https://github.com/gtkwave/libfst
Commit: bf53e719f099729cedc6e4e5d5400f79bd80c610

Reader/writer sources and bundled compression implementations.
Local portability patch: three chk_len_max constants use C enum constants instead
of const int, allowing fixed array sizes under MSVC. No algorithm changes.

See LICENSE and individual file headers for MIT / BSD notices.
